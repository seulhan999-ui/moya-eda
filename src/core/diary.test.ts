import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from '../catalog/ingredients';
import { RECIPES } from '../catalog/recipes';
import { batchLeftover, dayTotals, entryFor, findBatch, proposeRebalance, type Batch, type Entry } from './diary';
import { recipeNutrition, snapshot } from './nutrition';
import { balances, cook, purchase } from './stock';

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const snap = (id: string, p = 1) => snapshot(recipeNutrition(recipe(id), ingredients, p));
const entry = (o: Partial<Entry>): Entry => ({
  id: Math.random().toString(36), day: '2026-10-22', mealType: 'lunch', status: 'eaten', recipeId: 'lentil_soup', name: null,
  portions: 1, nutrition: snap('lentil_soup'), offPlan: false, fromBatch: null, stockWrittenOff: false, ...o,
});

describe('AC10 — приготовление и съеденное', () => {
  it('приготовление 3 порций списывает продукты один раз; три «Съел» из партии ничего не списывают', () => {
    const stock = [purchase('p', 'lentils_red', 500, 't'), purchase('p2', 'carrot', 500, 't'), purchase('p3', 'onion', 500, 't'), purchase('p4', 'tomato_paste', 140, 't'), purchase('p5', 'sunflower_oil', 500, 't')];
    const cooked = cook('cook-1', recipe('lentil_soup'), 3, ingredients, '2026-10-22T09:00:00Z');
    const batch: Batch = { id: 'b1', recipeId: 'lentil_soup', portions: 3, cookedAt: '2026-10-22T09:00:00Z' };
    const entries: Entry[] = [];
    for (let i = 0; i < 3; i++) {
      const b = findBatch('lentil_soup', 1, [batch], entries, '2026-10-22');
      expect(b?.id).toBe('b1');
      entries.push(entry({ fromBatch: b!.id, day: '2026-10-2' + (2 + Math.floor(i / 2)) }));
    }
    expect(batchLeftover(batch, entries)).toBe(0);
    expect(findBatch('lentil_soup', 1, [batch], entries, '2026-10-23')).toBeNull(); // четвёртой порции нет
    expect(balances([...stock, ...cooked]).get('lentils_red')).toBe(500 - 180); // 60 г × 3 — один раз
  });

  it('партия старше 3 дней не используется', () => {
    const batch: Batch = { id: 'b1', recipeId: 'lentil_soup', portions: 2, cookedAt: '2026-10-15T09:00:00Z' };
    expect(findBatch('lentil_soup', 1, [batch], [], '2026-10-22')).toBeNull();
  });

  it('пропуск не расходует приготовленные порции', () => {
    const batch: Batch = { id: 'b1', recipeId: 'lentil_soup', portions: 1, cookedAt: '2026-10-22T09:00:00Z' };
    expect(batchLeftover(batch, [entry({ fromBatch: 'b1', status: 'skipped' })])).toBe(1);
  });
});

describe('AC11 — дневник', () => {
  it('статусы различаются, неотмеченный приём не имеет записи', () => {
    const entries = [entry({ mealType: 'breakfast', status: 'eaten' }), entry({ mealType: 'lunch', status: 'skipped', nutrition: null })];
    expect(entryFor(entries, '2026-10-22', 'breakfast')?.status).toBe('eaten');
    expect(entryFor(entries, '2026-10-22', 'lunch')?.status).toBe('skipped');
    expect(entryFor(entries, '2026-10-22', 'dinner')).toBeUndefined(); // «Не отмечено»
  });

  it('итог дня: пропуск не считается, еда вне плана считается, неизвестное делает итог неполным', () => {
    const entries = [
      entry({ mealType: 'breakfast', recipeId: 'oat_pear_walnut', nutrition: snap('oat_pear_walnut') }),
      entry({ mealType: 'lunch', status: 'skipped', nutrition: null }),
      entry({ mealType: 'snack', offPlan: true, recipeId: null, name: 'Пирожок в столовой', nutrition: null }),
    ];
    const t = dayTotals(entries, '2026-10-22');
    expect(t.kcal.value).toBeCloseTo(snap('oat_pear_walnut').kcal.value!, 6);
    expect(t.kcal.complete).toBe(false);
  });

  it('фактическая порция учитывается в итоге', () => {
    const t = dayTotals([entry({ portions: 2, nutrition: snap('lentil_soup', 2) })], '2026-10-22');
    expect(t.kcal.value).toBeCloseTo(2 * snap('lentil_soup').kcal.value!, 0);
  });
});

describe('AC12 — коррекция дня', () => {
  const kcalOf = (id: string, p: number) => recipeNutrition(recipe(id), ingredients, p).kcal.value ?? 0;
  it('при большом недоборе предлагает блюдо посытнее из альтернатив', () => {
    const rem = [{ type: 'dinner' as const, recipeId: 'microwave_veg_eggs', alts: ['beef_veg_rice', 'tuna_bean_salad'], portions: 1 }];
    const p = proposeRebalance(400, rem, 2200, kcalOf);
    expect(p).not.toBeNull();
    expect(kcalOf(p!.toId, 1)).toBeGreaterThan(kcalOf('microwave_veg_eggs', 1));
  });
  it('если день близок к норме — ничего не предлагает', () => {
    const rem = [{ type: 'dinner' as const, recipeId: 'beef_veg_rice', alts: ['microwave_veg_eggs'], portions: 1 }];
    const k = kcalOf('beef_veg_rice', 1);
    expect(proposeRebalance(2000 - k, rem, 2000, kcalOf)).toBeNull();
  });
  it('без нормы — ничего не предлагает', () => {
    expect(proposeRebalance(0, [{ type: 'dinner', recipeId: 'beef_veg_rice', alts: [], portions: 1 }], null, kcalOf)).toBeNull();
  });
});
