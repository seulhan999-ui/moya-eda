import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from '../catalog/ingredients';
import { RECIPES } from '../catalog/recipes';
import { addDays, mondayOf, planWeek, suggestNew, type PlanInput } from './planner';
import { recipeNutrition } from './nutrition';
import type { DietMode } from './types';

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
const byId = new Map(RECIPES.map((r) => [r.id, r]));

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    recipes: RECIPES, ingredients, mode: 'smart_mix', weekStart: '2026-10-19',
    exclude: new Set(), likes: new Set(), dislikes: new Set(), tastes: new Map(),
    equipment: ['stove', 'microwave', 'oven', 'blender'], maxCookMin: 20, seed: 42, ...over,
  };
}

const ids = (v: ReturnType<typeof planWeek>['variants'][number]) => v.days.flatMap((d) => d.meals.map((m) => m.recipeId));

describe('Даты', () => {
  it('понедельник недели и сдвиг дней', () => {
    expect(mondayOf('2026-10-22')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('AC03 — три варианта на 7 дней', () => {
  const { variants } = planWeek(input());
  it('7 дней, завтрак/обед/ужин, все слоты заполнены', () => {
    expect(variants).toHaveLength(3);
    for (const v of variants) {
      expect(v.days).toHaveLength(7);
      for (const d of v.days) expect(d.meals.map((m) => m.type)).toEqual(['breakfast', 'lunch', 'dinner']);
      expect(ids(v).every(Boolean)).toBe(true);
    }
  });
  it('варианты заметно отличаются (не копии одного меню)', () => {
    const [a, b, c] = variants.map(ids);
    const diff = (x: unknown[], y: unknown[]) => x.filter((v, i) => v !== y[i]).length / x.length;
    expect(diff(a, b)).toBeGreaterThan(0.5);
    expect(diff(a, c)).toBeGreaterThan(0.5);
    expect(diff(b, c)).toBeGreaterThan(0.5);
  });
  it('блюдо не повторяется в один день и не больше двух раз за неделю', () => {
    for (const v of variants) {
      for (const d of v.days) expect(new Set(d.meals.map((m) => m.recipeId)).size).toBe(d.meals.length);
      const count = new Map<string, number>();
      for (const id of ids(v)) count.set(id!, (count.get(id!) ?? 0) + 1);
      expect(Math.max(...count.values())).toBeLessThanOrEqual(2);
    }
  });
  it('тип блюда подходит приёму пищи', () => {
    for (const v of variants) for (const d of v.days) for (const m of d.meals) expect(byId.get(m.recipeId!)!.mealTypes).toContain(m.type);
  });
});

describe('AC02 — режимы влияют на подбор, исключения сохраняются', () => {
  const share = (mode: DietMode) => {
    const all = planWeek(input({ mode })).variants.flatMap(ids);
    return all.filter((id) => byId.get(id!)!.modes.includes(mode)).length / all.length;
  };
  it('каждый режим даёт в основном блюда своего режима', () => {
    expect(share('economy')).toBeGreaterThan(0.7);
    expect(share('tasty')).toBeGreaterThan(0.6);
    expect(share('no_cook')).toBeGreaterThan(0.4);
  });
  it('«Умный микс» сочетает режимы по дням', () => {
    const all = planWeek(input({ mode: 'smart_mix' })).variants[0].days.flatMap((d) => d.meals.map((m) => byId.get(m.recipeId!)!));
    const modes = new Set(all.flatMap((r) => r.modes));
    expect(modes.has('economy') && modes.has('tasty') && modes.has('no_cook')).toBe(true);
  });
  it('исключённый продукт не попадает ни в блюда, ни в альтернативы при любом режиме', () => {
    for (const mode of ['economy', 'tasty', 'no_cook', 'smart_mix'] as DietMode[]) {
      const { variants } = planWeek(input({ mode, exclude: new Set(['egg', 'chicken_breast']) }));
      for (const v of variants) for (const d of v.days) for (const m of d.meals) {
        for (const id of [m.recipeId, ...m.alts]) {
          if (!id) continue;
          expect(byId.get(id)!.ingredients.some((ri) => ri.ingredientId === 'egg' || ri.ingredientId === 'chicken_breast')).toBe(false);
        }
      }
    }
  });
  it('без духовки и блендера такие блюда не предлагаются', () => {
    const { variants } = planWeek(input({ equipment: ['stove'] }));
    for (const v of variants) for (const id of ids(v)) expect(byId.get(id!)!.equipment.every((e) => e === 'stove' || e === 'none')).toBe(true);
  });
  it('«Больше не предлагать» исключает блюдо полностью', () => {
    const { variants } = planWeek(input({ tastes: new Map([['oat_pear_walnut', { never: true }]]) }));
    for (const v of variants) for (const d of v.days) for (const m of d.meals) expect([m.recipeId, ...m.alts]).not.toContain('oat_pear_walnut');
  });
  it('«Вкусно» и избранное появляются чаще, «Не понравилось» — реже', () => {
    const count = (tastes: PlanInput['tastes'], id: string) =>
      [1, 2, 3, 4, 5].reduce((s, seed) => s + planWeek(input({ seed, tastes })).variants.flatMap(ids).filter((x) => x === id).length, 0);
    const id = 'lentil_soup';
    expect(count(new Map([[id, { rating: 'tasty', favorite: true }]]), id)).toBeGreaterThan(count(new Map([[id, { rating: 'bad' }]]), id));
  });
});

describe('AC04 — закрепление и альтернативы', () => {
  it('закреплённое блюдо сохраняется при обновлении', () => {
    const pins = new Map([['2026-10-21:dinner', 'salmon_broccoli']]);
    for (const seed of [1, 2, 3]) {
      const { variants } = planWeek(input({ pins, seed }));
      for (const v of variants) {
        const slot = v.days[2].meals.find((m) => m.type === 'dinner')!;
        expect(slot.recipeId).toBe('salmon_broccoli');
        expect(slot.pinned).toBe(true);
      }
    }
  });
  it('у каждого приёма две разные альтернативы того же типа, соблюдающие ограничения', () => {
    const { variants } = planWeek(input({ exclude: new Set(['egg']) }));
    for (const d of variants[0].days) for (const m of d.meals) {
      expect(m.alts).toHaveLength(2);
      expect(new Set([m.recipeId, ...m.alts]).size).toBe(3);
      for (const a of m.alts) {
        expect(byId.get(a)!.mealTypes).toContain(m.type);
        expect(byId.get(a)!.ingredients.some((ri) => ri.ingredientId === 'egg')).toBe(false);
      }
    }
  });
});

describe('Невыполнимые условия', () => {
  it('если подходящих блюд нет — слот пустой с понятной причиной, а не выдуманное блюдо', () => {
    const { variants } = planWeek(input({ equipment: [], mealTypes: ['dinner'] }));
    const slot = variants[0].days[0].meals[0];
    // ужинов без плиты и духовки мало: часть слотов может оказаться пустой — но с причиной
    if (!slot.recipeId) expect(slot.note).toMatch(/Нет подходящих блюд/);
    else expect(byId.get(slot.recipeId)!.equipment.every((e) => e === 'none')).toBe(true);
  });
});

describe('«Хочу что-нибудь новое»', () => {
  it('предлагает неоценённое блюдо, которого нет в неделе, с учётом исключений', () => {
    const p = input({ exclude: new Set(['egg']), tastes: new Map([['pear_cheese', { rating: 'tasty' }]]) });
    const inWeek = new Set(['apple_peanut']);
    for (let s = 1; s < 20; s++) {
      const r = suggestNew('snack', p, inWeek, s)!;
      expect(r.mealTypes).toContain('snack');
      expect(inWeek.has(r.id)).toBe(false);
      expect(r.id).not.toBe('pear_cheese');
      expect(r.ingredients.some((ri) => ri.ingredientId === 'egg')).toBe(false);
    }
  });
});

describe('Энергия дня под норму', () => {
  it('при норме 2200 ккал дни меню попадают в разумный диапазон, названия вариантов разные', () => {
    const { variants } = planWeek(input({ targetKcal: 2200 }));
    expect(new Set(variants.map((v) => v.title)).size).toBe(3);
    for (const v of variants) for (const d of v.days) {
      const kcal = d.meals.reduce((s, m) => s + (recipeNutrition(byId.get(m.recipeId!)!, ingredients, m.portions).kcal.value ?? 0), 0);
      expect(kcal).toBeGreaterThan(2200 * 0.7);
      expect(kcal).toBeLessThan(2200 * 1.15);
      for (const m of d.meals) expect(m.portions).toBeLessThanOrEqual(2);
    }
  });
  it('без нормы порции не меняются', () => {
    const { variants } = planWeek(input());
    for (const v of variants) for (const d of v.days) for (const m of d.meals) expect(m.portions).toBe(1);
  });
});

describe('Баланс при подгонке под норму', () => {
  it('доля белка в среднем по неделе не выше 28 % энергии (защита от перекоса; цель МР — 12–14 %)', () => {
    for (const seed of [1, 7, 42]) {
      const { variants } = planWeek(input({ targetKcal: 2400, seed }));
      for (const v of variants) {
        let kcal = 0, protein = 0;
        for (const d of v.days) for (const m of d.meals) {
          const t = recipeNutrition(byId.get(m.recipeId!)!, ingredients, m.portions);
          kcal += t.kcal.value ?? 0;
          protein += t.protein.value ?? 0;
        }
        expect((protein * 4) / kcal).toBeLessThan(0.28);
        expect(kcal / 7).toBeGreaterThan(2400 * 0.8);
      }
    }
  });
});
