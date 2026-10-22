import { NUTRIENT_KEYS, type Ingredient, type NutrientKey, type Nutrients, type Recipe } from './types';
import { assertPortions, toBaseUnit } from './units';

/**
 * Итог по показателю: сумма известных частей и признак полноты.
 * value === null — неизвестно совсем; complete === false — часть данных отсутствует.
 */
export interface NutrientTotal {
  value: number | null;
  complete: boolean;
}

export type NutrientTotals = Record<NutrientKey, NutrientTotal>;

export function emptyTotals(): NutrientTotals {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, { value: null, complete: true }])) as NutrientTotals;
}

/** Прибавить слагаемое: неизвестное значение делает итог неполным, но не превращается в 0. */
export function addNutrients(total: NutrientTotals, part: Nutrients | null | undefined, factor = 1): NutrientTotals {
  const next = { ...total };
  for (const k of NUTRIENT_KEYS) {
    const v = part?.[k];
    if (v == null) {
      next[k] = { value: total[k].value, complete: false };
    } else {
      next[k] = { value: (total[k].value ?? 0) + v * factor, complete: total[k].complete };
    }
  }
  return next;
}

/** Пищевая ценность количества продукта (в его базовой единице). */
function ingredientPart(ingredient: Ingredient, baseAmount: number): { values: Nutrients | null; factor: number } {
  if (ingredient.unit === 'pcs') return { values: ingredient.perPiece ?? null, factor: baseAmount };
  return { values: ingredient.per100 ?? null, factor: baseAmount / 100 };
}

/**
 * Пищевая ценность рецепта на заданное число порций.
 * Ингредиенты «по вкусу» в расчёт не входят и делают итог неполным.
 */
export function recipeNutrition(
  recipe: Recipe,
  ingredients: Map<string, Ingredient>,
  portions = 1,
): NutrientTotals {
  assertPortions(portions);
  const scale = portions / recipe.servings;
  let total = emptyTotals();
  for (const ri of recipe.ingredients) {
    const ing = ingredients.get(ri.ingredientId);
    if (ing && ri.toTaste && ing.negligible) continue;
    if (!ing || ri.toTaste) {
      total = addNutrients(total, null);
      continue;
    }
    const base = toBaseUnit(ri.amount * scale, ri.unit, ing);
    const { values, factor } = ingredientPart(ing, base);
    total = addNutrients(total, values, factor);
  }
  return total;
}

/**
 * Снимок пищевой ценности для записи в дневник — копия на момент записи,
 * чтобы позднее изменение рецепта не меняло прошлые итоги.
 */
export function snapshot(totals: NutrientTotals): NutrientTotals {
  const out = {} as NutrientTotals;
  for (const k of NUTRIENT_KEYS) {
    const v = totals[k].value;
    out[k] = { value: v === null ? null : round1(v), complete: totals[k].complete };
  }
  return out;
}

/** Сложить несколько итогов (например, записи дневника за день). */
export function sumTotals(list: NutrientTotals[]): NutrientTotals {
  const out = emptyTotals();
  for (const t of list) {
    for (const k of NUTRIENT_KEYS) {
      const v = t[k].value;
      out[k] = {
        value: v === null ? out[k].value : (out[k].value ?? 0) + v,
        complete: out[k].complete && t[k].complete && v !== null,
      };
    }
  }
  return out;
}

/** Итог готов к показу полностью, если все показатели полные. */
export function isComplete(t: NutrientTotals): boolean {
  return NUTRIENT_KEYS.every((k) => t[k].complete && t[k].value !== null);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
