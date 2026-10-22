import type { Ingredient, Recipe, Unit } from '../core/types';
import { INGREDIENTS, INGREDIENT_ICON, PACK_SIZE } from './ingredients';
import { RECIPES } from './recipes';

export { INGREDIENTS, RECIPES, PACK_SIZE, INGREDIENT_ICON };

export const INGREDIENT_MAP = new Map<string, Ingredient>(INGREDIENTS.map((i) => [i.id, i]));
export const RECIPE_MAP = new Map<string, Recipe>(RECIPES.map((r) => [r.id, r]));

/** Количество для показа: «150 г», «1,5 шт», «по вкусу». */
export function formatQty(amount: number, unit: Unit): string {
  if (unit === 'pcs') {
    const v = Math.round(amount * 10) / 10;
    return `${String(v).replace('.', ',')} шт`;
  }
  const v = amount >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10;
  return `${String(v).replace('.', ',')} ${unit === 'g' ? 'г' : 'мл'}`;
}

export const MEAL_LABEL = { breakfast: 'Завтрак', lunch: 'Обед', snack: 'Перекус', dinner: 'Ужин' } as const;
export const MODE_LABEL = { economy: 'Экономный', tasty: 'Вкусно и разнообразно', no_cook: 'Почти без готовки', smart_mix: 'Умный микс' } as const;
