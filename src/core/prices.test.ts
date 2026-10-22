import { describe, expect, it } from 'vitest';
import { latestPrices, packagesFor } from './prices';

describe('AC20 — цены из покупок', () => {
  it('берётся последняя покупка, цена пересчитывается на упаковку', () => {
    const prices = latestPrices([
      { ingredientId: 'buckwheat', store: 'Лента', qty: 900, price: 120, date: '2026-10-01' },
      { ingredientId: 'buckwheat', store: 'Командор', qty: 900, price: 99, date: '2026-10-14' },
    ]);
    expect(prices.get('buckwheat')!.store).toBe('Командор');
    const pk = packagesFor(['buckwheat'], { buckwheat: 900 }, prices).get('buckwheat')!;
    expect(pk.price).toBe(99);
    expect(pk.store).toBe('Командор');
    expect(pk.priceDate).toBe('14.10');
  });

  it('товар на развес: цена за 1 г, упаковка — 1 г', () => {
    const prices = latestPrices([{ ingredientId: 'potato', store: 'Магнит', qty: 2000, price: 90, date: '2026-10-20' }]);
    const pk = packagesFor(['potato'], { potato: null }, prices).get('potato')!;
    expect(pk.size).toBe(1);
    expect(pk.price).toBeCloseTo(0.05, 6);
  });

  it('без покупки с ценой цена неизвестна', () => {
    const pk = packagesFor(['tomato'], { tomato: null }, new Map()).get('tomato')!;
    expect(pk.price).toBeUndefined();
  });

  it('некорректные записи игнорируются', () => {
    expect(latestPrices([{ ingredientId: 'x', store: 's', qty: 0, price: 10, date: '2026-10-20' }]).size).toBe(0);
  });
});
