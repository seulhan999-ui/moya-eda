import { describe, expect, it } from 'vitest';
import { isComplete, recipeNutrition } from '../core/nutrition';
import type { DietMode, MealType } from '../core/types';
import { INGREDIENTS, PACK_SIZE, INGREDIENT_ICON } from './ingredients';
import { RECIPES } from './recipes';

const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));

describe('Стартовый каталог', () => {
  it('не меньше 60 рецептов с уникальными id', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
  });

  it('покрыты все режимы и приёмы пищи', () => {
    const modes: DietMode[] = ['economy', 'tasty', 'no_cook'];
    for (const m of modes) expect(RECIPES.filter((r) => r.modes.includes(m)).length, m).toBeGreaterThanOrEqual(12);
    const meals: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
    for (const m of meals) expect(RECIPES.filter((r) => r.mealTypes.includes(m)).length, m).toBeGreaterThanOrEqual(10);
  });

  it('у каждого продукта есть упаковка (или развес) и иконка, у штучных — масса штуки', () => {
    for (const i of INGREDIENTS) {
      expect(i.id in PACK_SIZE, i.id).toBe(true);
      expect(INGREDIENT_ICON[i.id], i.id).toBeTruthy();
      if (i.unit === 'pcs') expect(i.pieceGrams, i.id).toBeGreaterThan(0);
      expect(i.nutrientRef, i.id).toMatch(/USDA FoodData Central/);
    }
  });

  for (const r of RECIPES) {
    it(`${r.name}: полная пищевая ценность и разумная калорийность порции`, () => {
      const t = recipeNutrition(r, ingredients, 1);
      expect(isComplete(t), 'неполные данные').toBe(true);
      const kcal = t.kcal.value!;
      const min = r.mealTypes.includes('snack') ? 80 : 200;
      expect(kcal).toBeGreaterThanOrEqual(min);
      expect(kcal).toBeLessThanOrEqual(800);
      // белки + жиры + углеводы согласованы с калорийностью (±20%)
      const fromMacros = 4 * t.protein.value! + 9 * t.fat.value! + 4 * t.carbs.value!;
      expect(Math.abs(fromMacros - kcal) / kcal).toBeLessThan(0.2);
      expect(r.timeActiveMin).toBeLessThanOrEqual(r.timeTotalMin);
      expect(r.steps.length).toBeGreaterThan(0);
      if (r.timeTotalMin > r.timeActiveMin + 10) expect(r.passive, 'пассивное время должно быть пояснено').toBeTruthy();
    });
  }
});
