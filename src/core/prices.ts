// Цены из ваших покупок: последняя известная цена за единицу (г, мл, шт) по каждому продукту.
// Цены не выдумываются: нет покупки с ценой — цена неизвестна.

import type { Package } from './types';

export interface PricePoint {
  ingredientId: string;
  store: string;
  /** Сколько купили, в базовых единицах продукта. */
  qty: number;
  /** Сколько заплатили за это количество, ₽. */
  price: number;
  date: string; // YYYY-MM-DD
}

/** Последняя цена по каждому продукту (по дате покупки). */
export function latestPrices(points: PricePoint[]): Map<string, PricePoint> {
  const out = new Map<string, PricePoint>();
  for (const p of points) {
    if (!(p.qty > 0) || !(p.price >= 0)) continue;
    const cur = out.get(p.ingredientId);
    if (!cur || p.date >= cur.date) out.set(p.ingredientId, p);
  }
  return out;
}

/**
 * Упаковки для расчёта корзины: размер — типичный для продукта, цена — из последней покупки,
 * пересчитанная на размер упаковки. Для продуктов на развес упаковкой считается 1 единица (1 г, 1 мл, 1 шт).
 */
export function packagesFor(ids: string[], packSize: Record<string, number | null>, prices: Map<string, PricePoint>): Map<string, Package> {
  const out = new Map<string, Package>();
  for (const id of ids) {
    const size = packSize[id] ?? 1;
    const p = prices.get(id);
    out.set(id, {
      ingredientId: id,
      size,
      price: p ? Math.round((p.price / p.qty) * size * 100) / 100 : undefined,
      store: p?.store,
      priceDate: p ? formatDate(p.date) : undefined,
    });
  }
  return out;
}

function formatDate(d: string): string {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
}
