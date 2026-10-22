import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from '../catalog/ingredients';
import { RECIPES } from '../catalog/recipes';
import { runTool, resultForModel, type ToolContext } from './tools';

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  recipes: RECIPES, ingredients, stock: new Map(), exclude: new Set(), never: new Set(), rated: new Set(), weekRecipes: [],
  shopping: () => ({ hasPlan: true, toBuy: 12, knownSum: 450, unpriced: 9, examples: ['Гречка', 'Минтай'] }), ...over,
});

describe('AC21 — шесть запросов помощника (исполнение функций приложения)', () => {
  it('«Что вкусного приготовить за 10 минут?» → блюда не дольше 10 минут', () => {
    const r = runTool('find_recipes', { max_minutes: 10 }, ctx());
    expect(r.kind).toBe('recipes');
    if (r.kind !== 'recipes') return;
    expect(r.items.length).toBeGreaterThan(0);
    for (const i of r.items) expect(i.minutes).toBeLessThanOrEqual(10);
  });

  it('«Собери продукты на неделю» → сводка корзины из приложения', () => {
    const r = runTool('shopping_summary', {}, ctx());
    expect(r).toMatchObject({ kind: 'shopping', toBuy: 12, knownSum: 450, unpriced: 9 });
    expect(resultForModel(r)).toContain('items_without_price');
  });

  it('«Найди дешевле» → советы из блюд недели, цены не выдумываются', () => {
    const r = runTool('cheaper_options', {}, ctx({ weekRecipes: ['bulgur_chicken_pepper', 'oat_pear_walnut'] }));
    expect(r.kind).toBe('cheaper');
    if (r.kind !== 'cheaper') return;
    expect(r.tips.map((t) => t.recipe)).toContain('Булгур с курицей и печёным перцем');
    expect(resultForModel(r)).toContain('"prices_known":false');
  });

  it('«Хочу что-нибудь необычное» → только неоценённые блюда', () => {
    const rated = new Set(RECIPES.slice(0, 50).map((r) => r.id));
    const r = runTool('find_recipes', { unusual: true }, ctx({ rated }));
    if (r.kind !== 'recipes') throw new Error();
    for (const i of r.items) expect(rated.has(i.id)).toBe(false);
  });

  it('«Сегодня не завтракал» → действие ждёт подтверждения, ничего не меняется само', () => {
    expect(runTool('mark_meal', { meal: 'breakfast', status: 'skipped' }, ctx())).toEqual({ kind: 'confirm', meal: 'breakfast', status: 'skipped' });
    expect(runTool('mark_meal', '{"meal":"обед","status":"skipped"}', ctx()).kind).toBe('error');
  });

  it('«Что приготовить из продуктов в холодильнике?» → блюда из запасов, иначе честная подсказка', () => {
    const empty = runTool('find_recipes', { from_stock: true }, ctx());
    if (empty.kind !== 'recipes') throw new Error();
    expect(empty.items).toHaveLength(0);
    expect(empty.note).toMatch(/Есть дома/);
    const stock = new Map([['cottage', 500], ['apple', 500], ['walnuts', 100]]);
    const r = runTool('find_recipes', { from_stock: true }, ctx({ stock }));
    if (r.kind !== 'recipes') throw new Error();
    expect(r.items.map((i) => i.id)).toContain('cottage_apple_cinnamon');
    for (const i of r.items) expect(i.atHome).toBe(100);
  });

  it('исключённые продукты и «больше не предлагать» не попадают в ответы', () => {
    const r = runTool('find_recipes', { query: 'рыба' }, ctx({ exclude: new Set(['pollock']), never: new Set(['salmon_couscous']) }));
    if (r.kind !== 'recipes') throw new Error();
    for (const i of r.items) {
      expect(i.id).not.toBe('salmon_couscous');
      expect(RECIPES.find((x) => x.id === i.id)!.ingredients.some((ri) => ri.ingredientId === 'pollock')).toBe(false);
    }
  });

  it('неизвестная функция — понятная ошибка', () => {
    expect(runTool('buy_everything', {}, ctx()).kind).toBe('error');
  });
});

describe('Устойчивость к формулировкам модели', () => {
  it('общие слова в запросе («вкусное», «быстро») не обнуляют выдачу', () => {
    const r = runTool('find_recipes', { query: 'вкусное быстро', max_minutes: 10 }, ctx());
    if (r.kind !== 'recipes') throw new Error();
    expect(r.items.length).toBeGreaterThan(0);
    for (const i of r.items) expect(i.minutes).toBeLessThanOrEqual(10);
  });
  it('время строкой тоже понимается', () => {
    const r = runTool('find_recipes', '{"max_minutes":"10"}', ctx());
    if (r.kind !== 'recipes') throw new Error();
    expect(r.items.length).toBeGreaterThan(0);
  });
});
