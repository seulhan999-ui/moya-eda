import { describe, expect, it } from 'vitest';
import type { Ingredient, Package, Recipe } from './types';
import { isComplete, recipeNutrition, snapshot, sumTotals } from './nutrition';
import { buildShoppingList } from './shopping';
import { balances, cook, correction, negativeStock, purchase, reverse } from './stock';
import { QuantityError, assertPortions, toBaseUnit } from './units';

const N = (kcal: number | null, protein: number | null, fat: number | null, carbs: number | null, fiber: number | null) =>
  ({ kcal, protein, fat, carbs, fiber });

const ING: Ingredient[] = [
  { id: 'buckwheat', name: 'Гречка', unit: 'g', state: 'dry', department: 'grains', per100: N(313, 12.6, 3.3, 62, 10) },
  { id: 'chicken', name: 'Куриное филе', unit: 'g', state: 'raw', department: 'meat_fish', per100: N(110, 23, 1.2, 0, 0) },
  { id: 'egg', name: 'Яйцо', unit: 'pcs', state: 'raw', department: 'dairy', pieceGrams: 55, perPiece: N(78, 6.3, 5.3, 0.6, 0) },
  { id: 'oil', name: 'Масло оливковое', unit: 'ml', state: 'as_is', department: 'grocery', density: 0.92, per100: N(820, 0, 92, 0, 0) },
  { id: 'yogurt', name: 'Йогурт', unit: 'g', state: 'as_is', department: 'dairy', per100: N(66, 9, 2, 4, null) }, // клетчатка неизвестна
  { id: 'salt', name: 'Соль', unit: 'g', state: 'as_is', department: 'grocery' },
];
const ingredients = new Map(ING.map((i) => [i.id, i]));

const rec = (id: string, servings: number, items: Recipe['ingredients']): Recipe => ({
  id, name: id, servings, ingredients: items, steps: [], timeTotalMin: 20, timeActiveMin: 10,
  modes: ['smart_mix'], mealTypes: ['lunch'], equipment: ['stove'], source: 'Каталог «Моя еда»', verified: true,
});

const buckwheatBowl = rec('buckwheat_bowl', 1, [
  { ingredientId: 'buckwheat', amount: 300, unit: 'g' },
  { ingredientId: 'salt', amount: 0, unit: 'g', toTaste: true },
]);
const chickenBuckwheat = rec('chicken_buckwheat', 2, [
  { ingredientId: 'buckwheat', amount: 300, unit: 'g' },
  { ingredientId: 'chicken', amount: 300, unit: 'g' },
  { ingredientId: 'oil', amount: 10, unit: 'ml' },
]);
const yogurtBowl = rec('yogurt_bowl', 1, [
  { ingredientId: 'yogurt', amount: 150, unit: 'g' },
  { ingredientId: 'egg', amount: 1, unit: 'pcs' },
]);
const recipes = new Map([buckwheatBowl, chickenBuckwheat, yogurtBowl].map((r) => [r.id, r]));
const pkgs = (list: Package[]) => new Map(list.map((p) => [p.ingredientId, p]));

describe('AC05 — порции', () => {
  it('при смене 1 → 2 порций ингредиенты и показатели масштабируются согласованно', () => {
    const one = recipeNutrition(chickenBuckwheat, ingredients, 1);
    const two = recipeNutrition(chickenBuckwheat, ingredients, 2);
    expect(two.kcal.value!).toBeCloseTo(one.kcal.value! * 2, 6);
    expect(two.protein.value!).toBeCloseTo(one.protein.value! * 2, 6);
    // 1 порция = половина рецепта на 2 порции: 150 г гречки + 150 г курицы + 5 мл масла
    expect(one.kcal.value!).toBeCloseTo(1.5 * 313 + 1.5 * 110 + 0.05 * 820, 6);
    expect(chickenBuckwheat.source).toBe('Каталог «Моя еда»');
  });

  it('половина порции допустима, ноль и отрицательные — нет', () => {
    expect(() => assertPortions(0.5)).not.toThrow();
    expect(() => assertPortions(0)).toThrow(QuantityError);
    expect(() => assertPortions(-1)).toThrow(QuantityError);
    expect(() => assertPortions(Number.NaN)).toThrow(QuantityError);
    expect(() => assertPortions(1.3)).toThrow(QuantityError);
  });
});

describe('AC06 — недостача', () => {
  it('нужно 600 г, дома 200 г → купить 400 г', () => {
    const list = buildShoppingList({
      planned: [{ recipeId: 'buckwheat_bowl', portions: 2 }],
      recipes, ingredients, pantry: new Map([['buckwheat', 200]]), packages: new Map(),
    });
    const line = list.lines.find((l) => l.ingredientId === 'buckwheat')!;
    expect(line.need).toBe(600);
    expect(line.shortage).toBe(400);
  });

  it('если дома больше, чем нужно, — недостача 0 и строки к покупке нет', () => {
    const list = buildShoppingList({
      planned: [{ recipeId: 'buckwheat_bowl', portions: 2 }],
      recipes, ingredients, pantry: new Map([['buckwheat', 900]]), packages: new Map(),
    });
    expect(list.lines.find((l) => l.ingredientId === 'buckwheat')).toBeUndefined();
  });
});

describe('AC07 — упаковки', () => {
  it('недостача 400 г, упаковка 500 г → 1 упаковка, остаток после готовки 100 г', () => {
    const list = buildShoppingList({
      planned: [{ recipeId: 'buckwheat_bowl', portions: 2 }],
      recipes, ingredients, pantry: new Map([['buckwheat', 200]]),
      packages: pkgs([{ ingredientId: 'buckwheat', size: 500, price: 89, store: 'Командор', priceDate: '14.10' }]),
    });
    const line = list.lines.find((l) => l.ingredientId === 'buckwheat')!;
    expect(line.packs).toBe(1);
    expect(line.plannedLeftover).toBe(100);
    expect(line.cost).toBe(89);
  });

  it('после подтверждения покупки фактический запас растёт на купленное количество', () => {
    const before = [purchase('p1', 'buckwheat', 200, '2026-10-20')];
    const after = [...before, purchase('p2', 'buckwheat', 500, '2026-10-21', { price: 89, store: 'Командор' })];
    expect(balances(before).get('buckwheat')).toBe(200);
    expect(balances(after).get('buckwheat')).toBe(700);
  });

  it('ровная недостача не даёт лишнюю упаковку из-за округления', () => {
    const list = buildShoppingList({
      planned: [{ recipeId: 'buckwheat_bowl', portions: 1 }],
      recipes, ingredients, pantry: new Map(), packages: pkgs([{ ingredientId: 'buckwheat', size: 100 }]),
    });
    expect(list.lines[0].packs).toBe(3);
    expect(list.lines[0].plannedLeftover).toBe(0);
  });
});

describe('AC08 — несколько блюд', () => {
  it('один запас распределяется на общую потребность один раз', () => {
    const list = buildShoppingList({
      planned: [
        { recipeId: 'buckwheat_bowl', portions: 1 }, // 300 г
        { recipeId: 'chicken_buckwheat', portions: 2 }, // 300 г
      ],
      recipes, ingredients, pantry: new Map([['buckwheat', 200]]), packages: new Map(),
    });
    const line = list.lines.find((l) => l.ingredientId === 'buckwheat')!;
    expect(line.need).toBe(600);
    expect(line.shortage).toBe(400); // не 100 + 100 и не 600 − 200·2
  });

  it('корзина строится только по активному меню — варианты не суммируются', () => {
    const active = [{ recipeId: 'buckwheat_bowl', portions: 2 }];
    const list = buildShoppingList({ planned: active, recipes, ingredients, pantry: new Map(), packages: new Map() });
    expect(list.lines.find((l) => l.ingredientId === 'buckwheat')!.need).toBe(600);
  });
});

describe('AC09 — покупки', () => {
  it('ручные дополнения сохраняются при пересчёте меню', () => {
    const manual = [{ id: 'm1', ingredientId: 'egg', amount: 10, unit: 'pcs' as const }];
    const a = buildShoppingList({ planned: [{ recipeId: 'yogurt_bowl', portions: 1 }], recipes, ingredients, pantry: new Map(), packages: new Map(), manual });
    const b = buildShoppingList({ planned: [{ recipeId: 'buckwheat_bowl', portions: 1 }], recipes, ingredients, pantry: new Map(), packages: new Map(), manual });
    expect(a.lines.find((l) => l.ingredientId === 'egg')!.toBuy).toBe(11);
    expect(b.lines.find((l) => l.ingredientId === 'egg')!.toBuy).toBe(10);
  });

  it('повторная обработка одной покупки при синхронизации не добавляет запас второй раз', () => {
    const p = purchase('buy-1', 'buckwheat', 500, '2026-10-21');
    expect(balances([p, p, { ...p }]).get('buckwheat')).toBe(500);
  });
});

describe('AC10 — приготовление', () => {
  it('планирование не списывает продукты', () => {
    const stock = [purchase('p', 'buckwheat', 1000, 't')];
    buildShoppingList({ planned: [{ recipeId: 'buckwheat_bowl', portions: 3 }], recipes, ingredients, pantry: balances(stock), packages: new Map() });
    expect(balances(stock).get('buckwheat')).toBe(1000);
  });

  it('приготовление 3 порций списывает один раз; повторная отправка не списывает снова', () => {
    const stock = [purchase('p', 'buckwheat', 1000, 't')];
    const cooked = cook('cook-1', buckwheatBowl, 3, ingredients, 't');
    const all = [...stock, ...cooked, ...cook('cook-1', buckwheatBowl, 3, ingredients, 't')];
    expect(balances(all).get('buckwheat')).toBe(100);
    expect(cooked.find((m) => m.ingredientId === 'salt')).toBeUndefined(); // «по вкусу» не списывается
  });

  it('отмена готовки возвращает продукты, повторная отмена ничего не делает', () => {
    const stock = [purchase('p', 'buckwheat', 1000, 't'), ...cook('cook-1', buckwheatBowl, 1, ingredients, 't')];
    const rev = reverse('cook-1', stock, 't');
    const withRev = [...stock, ...rev];
    expect(balances(withRev).get('buckwheat')).toBe(1000);
    expect(reverse('cook-1', withRev, 't')).toHaveLength(0);
  });

  it('нехватка запаса не обнуляется скрыто, а видна для уточнения', () => {
    const stock = [purchase('p', 'buckwheat', 100, 't'), ...cook('c', buckwheatBowl, 1, ingredients, 't')];
    expect(balances(stock).get('buckwheat')).toBe(-200);
    expect(negativeStock(stock)).toEqual(['buckwheat']);
    const fix = correction('fix', 'buckwheat', -200, 0, 't');
    expect(balances([...stock, fix]).get('buckwheat')).toBe(0);
  });
});

describe('AC13 — пищевая ценность', () => {
  it('отсутствующая клетчатка не превращается в 0, итог помечен неполным', () => {
    const t = recipeNutrition(yogurtBowl, ingredients, 1);
    expect(t.fiber.complete).toBe(false);
    expect(t.fiber.value).toBe(0); // известная часть (яйцо: 0 г), но итог неполный
    expect(t.kcal.complete).toBe(true);
    expect(isComplete(t)).toBe(false);
  });

  it('продукт без данных даёт null, а не 0', () => {
    const r = rec('salt_only', 1, [{ ingredientId: 'salt', amount: 5, unit: 'g' }]);
    const t = recipeNutrition(r, ingredients, 1);
    expect(t.kcal.value).toBeNull();
    expect(t.kcal.complete).toBe(false);
  });

  it('данные на 100 г пересчитываются по фактической массе порции', () => {
    const r = rec('yog', 1, [{ ingredientId: 'yogurt', amount: 150, unit: 'g' }]);
    expect(recipeNutrition(r, ingredients, 1).kcal.value).toBeCloseTo(99, 6); // 66 × 1,5, а не 66
  });

  it('итог дня по снимкам: неполная запись делает итог неполным; прошлое не меняется при правке рецепта', () => {
    const snapA = snapshot(recipeNutrition(chickenBuckwheat, ingredients, 1));
    const snapB = snapshot(recipeNutrition(yogurtBowl, ingredients, 1));
    const day = sumTotals([snapA, snapB]);
    expect(day.fiber.complete).toBe(false);
    expect(day.kcal.complete).toBe(true);
    const kcalBefore = day.kcal.value;
    chickenBuckwheat.ingredients[0].amount = 900; // рецепт изменили позже
    expect(sumTotals([snapA, snapB]).kcal.value).toBe(kcalBefore);
    chickenBuckwheat.ingredients[0].amount = 300;
  });
});

describe('Единицы', () => {
  it('штуки → граммы только при известной массе штуки, граммы → мл только при плотности', () => {
    expect(toBaseUnit(2, 'pcs', { ...ingredients.get('chicken')!, pieceGrams: 200 })).toBe(400);
    expect(() => toBaseUnit(2, 'pcs', ingredients.get('chicken')!)).toThrow(QuantityError);
    expect(toBaseUnit(92, 'g', ingredients.get('oil')!)).toBeCloseTo(100, 6);
    expect(() => toBaseUnit(10, 'ml', ingredients.get('buckwheat')!)).toThrow(QuantityError);
  });
});

describe('Стоимость корзины', () => {
  it('без цены итог помечен неполным и цена не придумывается', () => {
    const list = buildShoppingList({
      planned: [{ recipeId: 'chicken_buckwheat', portions: 2 }],
      recipes, ingredients, pantry: new Map(),
      packages: pkgs([{ ingredientId: 'buckwheat', size: 500, price: 89 }, { ingredientId: 'chicken', size: 700 }]),
    });
    expect(list.knownCost).toBe(89);
    expect(list.unpriced).toBe(2); // курица без цены, масло без упаковки
    expect(list.costComplete).toBe(false);
    expect(list.lines.find((l) => l.ingredientId === 'chicken')!.cost).toBeNull();
  });
});
