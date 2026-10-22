// Дневник питания: план и факт — разные события.
// «Приготовил» списывает продукты один раз и создаёт порции; «Съел» берёт порцию из приготовленного
// и продукты повторно не списывает. Еда вне дома продукты не списывает вовсе.

import { emptyTotals, sumTotals, type NutrientTotals } from './nutrition';
import type { MealType } from './types';

export type EntryStatus = 'eaten' | 'replaced' | 'skipped';

export interface Entry {
  id: string;
  day: string;
  mealType: MealType | null;
  status: EntryStatus;
  recipeId: string | null;
  name: string | null;
  portions: number;
  /** Снимок пищевой ценности на момент записи (не меняется при правке рецепта). */
  nutrition: NutrientTotals | null;
  offPlan: boolean;
  fromBatch: string | null;
  stockWrittenOff: boolean;
}

export interface Batch {
  id: string;
  recipeId: string;
  portions: number;
  cookedAt: string; // ISO
}

/** Сколько порций осталось от приготовленного. */
export function batchLeftover(b: Batch, entries: Entry[]): number {
  const used = entries.filter((e) => e.fromBatch === b.id && e.status !== 'skipped').reduce((s, e) => s + e.portions, 0);
  return Math.max(0, b.portions - used);
}

/** Подходящая приготовленная партия: то же блюдо, приготовлено не раньше чем 3 дня назад, порций хватает. */
export function findBatch(recipeId: string, portions: number, batches: Batch[], entries: Entry[], today: string, excludeEntry?: string): Batch | null {
  const others = excludeEntry ? entries.filter((e) => e.id !== excludeEntry) : entries;
  const fresh = batches
    .filter((b) => b.recipeId === recipeId && daysBetween(b.cookedAt.slice(0, 10), today) <= 3)
    .sort((a, b) => a.cookedAt.localeCompare(b.cookedAt));
  return fresh.find((b) => batchLeftover(b, others) >= portions - 1e-9) ?? null;
}

/** Запись приёма пищи по плану (одна на приём) — для статуса в «Сегодня». */
export function entryFor(entries: Entry[], day: string, type: MealType): Entry | undefined {
  return entries.find((e) => e.day === day && e.mealType === type && !e.offPlan);
}

/** Итог дня по записям. Пропуски не учитываются; запись без данных делает итог неполным. */
export function dayTotals(entries: Entry[], day: string): NutrientTotals {
  const list = entries.filter((e) => e.day === day && e.status !== 'skipped');
  if (list.length === 0) return emptyTotals();
  return sumTotals(list.map((e) => e.nutrition ?? unknownTotals()));
}

function unknownTotals(): NutrientTotals {
  const t = emptyTotals();
  for (const k of Object.keys(t) as (keyof NutrientTotals)[]) t[k] = { value: null, complete: false };
  return t;
}

export interface RebalanceSlot {
  type: MealType;
  recipeId: string;
  alts: string[];
  portions: number;
}

export interface Proposal {
  type: MealType;
  fromId: string;
  toId: string;
  reason: string;
}

/**
 * Предложение поправить остаток дня после пропуска или замены: если по плану день заметно
 * не дотягивает до нормы (или перебирает) — подобрать для следующего приёма альтернативу,
 * которая ближе к норме. Ничего не меняет: применяется только после подтверждения.
 */
export function proposeRebalance(
  eatenKcal: number, remaining: RebalanceSlot[], target: number | null, kcalOf: (id: string, portions: number) => number,
): Proposal | null {
  if (!target || remaining.length === 0) return null;
  const planned = remaining.reduce((s, r) => s + kcalOf(r.recipeId, r.portions), 0);
  const total = eatenKcal + planned;
  const gap = target - total;
  if (Math.abs(gap) < target * 0.15) return null;
  const next = remaining[0];
  const cur = kcalOf(next.recipeId, next.portions);
  let best: { id: string; diff: number } | null = null;
  for (const id of next.alts) {
    const k = kcalOf(id, next.portions);
    const diff = Math.abs(gap - (k - cur));
    if ((gap > 0 ? k > cur : k < cur) && (!best || diff < best.diff)) best = { id, diff };
  }
  if (!best) return null;
  return {
    type: next.type, fromId: next.recipeId, toId: best.id,
    reason: gap > 0 ? 'До нормы сегодня не хватает энергии — можно взять блюдо посытнее' : 'Сегодня уже больше нормы — можно взять блюдо полегче',
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000);
}
