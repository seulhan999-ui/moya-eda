import type { Ingredient, Recipe } from './types';
import { assertAmount, assertPortions, toBaseUnit } from './units';

/**
 * Журнал движения продуктов. Запас — сумма движений.
 * Изменение меню движением НЕ является: продукты списывает только «Приготовил».
 */
export type MovementKind = 'purchase' | 'cook' | 'correction' | 'reversal';

export interface StockMovement {
  /** Уникальный идентификатор операции: повтор при синхронизации не применяется дважды. */
  opId: string;
  ingredientId: string;
  /** Изменение в базовых единицах: + приход, − расход. */
  delta: number;
  kind: MovementKind;
  /** Для отмены — операция, которую отменяем. Для приготовления — общий идентификатор готовки. */
  refId?: string;
  at: string;
  /** Цена покупки, если указана (из чека). */
  price?: number;
  store?: string;
}

/** Убрать повторы одной и той же операции (повторная отправка, синхронизация). */
export function dedupe(movements: StockMovement[]): StockMovement[] {
  const seen = new Set<string>();
  const out: StockMovement[] = [];
  for (const m of movements) {
    if (seen.has(m.opId)) continue;
    seen.add(m.opId);
    out.push(m);
  }
  return out;
}

/** Текущий запас по каждому продукту. Отрицательный остаток не обнуляется скрыто. */
export function balances(movements: StockMovement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of dedupe(movements)) {
    out.set(m.ingredientId, (out.get(m.ingredientId) ?? 0) + m.delta);
  }
  return out;
}

/** Продукты, по которым запас ушёл в минус — повод попросить пользователя уточнить данные. */
export function negativeStock(movements: StockMovement[]): string[] {
  return [...balances(movements)].filter(([, v]) => v < -1e-9).map(([id]) => id);
}

export function purchase(
  opId: string,
  ingredientId: string,
  amount: number,
  at: string,
  extra?: { price?: number; store?: string },
): StockMovement {
  assertAmount(amount, 'Купленное количество');
  return { opId, ingredientId, delta: amount, kind: 'purchase', at, ...extra };
}

/**
 * «Приготовил»: одно списание ингредиентов на всё приготовленное количество порций.
 * Каждое движение получает свой opId, производный от идентификатора готовки.
 */
export function cook(
  cookId: string,
  recipe: Recipe,
  portions: number,
  ingredients: Map<string, Ingredient>,
  at: string,
): StockMovement[] {
  assertPortions(portions);
  const scale = portions / recipe.servings;
  const out: StockMovement[] = [];
  for (const ri of recipe.ingredients) {
    if (ri.toTaste) continue;
    const ing = ingredients.get(ri.ingredientId);
    if (!ing) continue;
    out.push({
      opId: `${cookId}:${ing.id}`,
      ingredientId: ing.id,
      delta: -toBaseUnit(ri.amount * scale, ri.unit, ing),
      kind: 'cook',
      refId: cookId,
      at,
    });
  }
  return out;
}

/** Ручная правка остатка: записывается разница, история сохраняется. */
export function correction(opId: string, ingredientId: string, current: number, actual: number, at: string): StockMovement {
  if (!Number.isFinite(actual) || actual < 0) throw new Error('Остаток: нужно число не меньше нуля');
  return { opId, ingredientId, delta: actual - current, kind: 'correction', at };
}

/**
 * Отмена операции — обратной записью. Отменить можно один раз;
 * для готовки отменяются все её списания.
 */
export function reverse(target: string, movements: StockMovement[], at: string): StockMovement[] {
  const list = dedupe(movements);
  const reversed = new Set(list.filter((m) => m.kind === 'reversal').map((m) => m.refId));
  const hits = list.filter((m) => m.kind !== 'reversal' && (m.opId === target || m.refId === target));
  return hits
    .filter((m) => !reversed.has(m.opId))
    .map((m) => ({ opId: `rev:${m.opId}`, ingredientId: m.ingredientId, delta: -m.delta, kind: 'reversal', refId: m.opId, at }));
}
