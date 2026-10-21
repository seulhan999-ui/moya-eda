import type { Department, Ingredient, Package, Recipe, Unit } from './types';
import { assertAmount, assertPortions, toBaseUnit } from './units';

/** Блюдо активного меню с количеством порций. */
export interface PlannedPortion {
  recipeId: string;
  portions: number;
}

/** Покупка, добавленная вручную. Сохраняется при пересчёте меню. */
export interface ManualItem {
  id: string;
  ingredientId: string;
  amount: number;
  unit: Unit;
}

export interface ShoppingLine {
  ingredientId: string;
  name: string;
  unit: Unit;
  department: Department;
  /** Потребность всех блюд активного меню. */
  need: number;
  /** Сколько есть дома (учтено один раз на всю потребность). */
  available: number;
  /** Недостача: max(0, потребность − запас). */
  shortage: number;
  /** Ручное дополнение сверх меню. */
  manual: number;
  /** Сколько купить: недостача + ручное дополнение. */
  toBuy: number;
  /** Число упаковок (если размер известен), округлено вверх. */
  packs: number | null;
  packSize: number | null;
  /** Сколько останется после приготовления меню (если упаковка известна). */
  plannedLeftover: number | null;
  /** Стоимость покупаемых упаковок; null — цена неизвестна. */
  cost: number | null;
  priceSource: string | null;
  /** Есть ингредиенты «по вкусу» без точного количества. */
  toTaste: boolean;
}

export interface ShoppingList {
  lines: ShoppingLine[];
  /** Сумма по позициям с известной ценой. */
  knownCost: number;
  /** Позиций к покупке без цены. */
  unpriced: number;
  /** Стоимость определена полностью (иначе — неполная оценка). */
  costComplete: boolean;
}

export interface ShoppingInput {
  /** Только АКТИВНОЕ меню: три варианта недели не суммируются. */
  planned: PlannedPortion[];
  recipes: Map<string, Recipe>;
  ingredients: Map<string, Ingredient>;
  /** Фактический запас дома в базовых единицах. */
  pantry: Map<string, number>;
  packages: Map<string, Package>;
  manual?: ManualItem[];
}

export function buildShoppingList(input: ShoppingInput): ShoppingList {
  const need = new Map<string, number>();
  const toTaste = new Set<string>();

  for (const p of input.planned) {
    assertPortions(p.portions);
    const recipe = input.recipes.get(p.recipeId);
    if (!recipe) continue;
    const scale = p.portions / recipe.servings;
    for (const ri of recipe.ingredients) {
      const ing = input.ingredients.get(ri.ingredientId);
      if (!ing) continue;
      if (ri.toTaste) {
        toTaste.add(ing.id);
        if (!need.has(ing.id)) need.set(ing.id, 0);
        continue;
      }
      need.set(ing.id, (need.get(ing.id) ?? 0) + toBaseUnit(ri.amount * scale, ri.unit, ing));
    }
  }

  const manual = new Map<string, number>();
  for (const m of input.manual ?? []) {
    assertAmount(m.amount);
    const ing = input.ingredients.get(m.ingredientId);
    if (!ing) continue;
    manual.set(ing.id, (manual.get(ing.id) ?? 0) + toBaseUnit(m.amount, m.unit, ing));
    if (!need.has(ing.id)) need.set(ing.id, 0);
  }

  const lines: ShoppingLine[] = [];
  for (const [id, needAmount] of need) {
    const ing = input.ingredients.get(id)!;
    const available = Math.max(0, input.pantry.get(id) ?? 0);
    const shortage = Math.max(0, needAmount - available);
    const extra = manual.get(id) ?? 0;
    const toBuy = shortage + extra;
    const tasteOnly = toTaste.has(id) && needAmount === 0 && extra === 0;
    if (toBuy <= 0 && !(tasteOnly && available === 0)) continue;

    const pkg = input.packages.get(id);
    const packs = pkg && toBuy > 0 ? Math.ceil(round6(toBuy / pkg.size)) : null;
    const plannedLeftover = packs !== null && pkg ? available + packs * pkg.size - needAmount - extra : null;
    const cost = packs !== null && pkg?.price != null ? packs * pkg.price : null;

    lines.push({
      ingredientId: id,
      name: ing.name,
      unit: ing.unit,
      department: ing.department,
      need: needAmount,
      available,
      shortage,
      manual: extra,
      toBuy,
      packs,
      packSize: pkg?.size ?? null,
      plannedLeftover,
      cost,
      priceSource: cost !== null && pkg?.store ? `${pkg.store}${pkg.priceDate ? ' · ' + pkg.priceDate : ''}` : null,
      toTaste: toTaste.has(id),
    });
  }

  const priced = lines.filter((l) => l.toBuy > 0);
  const knownCost = priced.reduce((s, l) => s + (l.cost ?? 0), 0);
  const unpriced = priced.filter((l) => l.cost === null).length;
  return { lines, knownCost, unpriced, costComplete: unpriced === 0 };
}

/** Защита от ошибок округления вида 400/400 = 1.0000000002. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
