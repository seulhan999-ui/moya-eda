import type { Ingredient, Unit } from './types';

export class QuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantityError';
  }
}

/** Количество должно быть конечным положительным числом. */
export function assertAmount(amount: number, what = 'Количество'): void {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new QuantityError(`${what}: нужно число`);
  }
  if (amount <= 0) throw new QuantityError(`${what}: должно быть больше нуля`);
}

/** Порции: больше нуля, шаг — половина порции. */
export function assertPortions(portions: number): void {
  assertAmount(portions, 'Порции');
  if (Math.round(portions * 2) !== portions * 2) {
    throw new QuantityError('Порции: можно указывать целые или половину порции');
  }
}

/**
 * Перевод количества в базовую единицу продукта.
 * Граммы ↔ миллилитры — только при известной плотности,
 * штуки ↔ граммы — только при известной массе штуки.
 */
export function toBaseUnit(amount: number, unit: Unit, ingredient: Ingredient): number {
  const to = ingredient.unit;
  if (unit === to) return amount;
  const key = `${unit}->${to}`;
  switch (key) {
    case 'g->ml':
      if (!ingredient.density) break;
      return amount / ingredient.density;
    case 'ml->g':
      if (!ingredient.density) break;
      return amount * ingredient.density;
    case 'pcs->g':
      if (!ingredient.pieceGrams) break;
      return amount * ingredient.pieceGrams;
    case 'g->pcs':
      if (!ingredient.pieceGrams) break;
      return amount / ingredient.pieceGrams;
  }
  throw new QuantityError(
    `${ingredient.name}: нельзя перевести ${unitLabel(unit)} в ${unitLabel(to)} без справочных данных`,
  );
}

export function unitLabel(unit: Unit): string {
  return unit === 'g' ? 'г' : unit === 'ml' ? 'мл' : 'шт';
}

/** Округление для показа: граммы и мл — до целых, штуки — до десятых. */
export function roundQty(amount: number, unit: Unit): number {
  return unit === 'pcs' ? Math.round(amount * 10) / 10 : Math.round(amount);
}
