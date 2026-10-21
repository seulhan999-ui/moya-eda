// Базовые типы расчётного ядра «Моя еда».
// Ядро не зависит от интерфейса, Supabase и ИИ: только данные и правила.

/** Внутренние базовые единицы: граммы, миллилитры, штуки. */
export type Unit = 'g' | 'ml' | 'pcs';

/** Состояние продукта: вес сырого и готового не смешиваются. */
export type FoodState = 'raw' | 'dry' | 'cooked' | 'as_is';

/** Отдел магазина для группировки списка покупок. */
export type Department =
  | 'vegetables'
  | 'meat_fish'
  | 'dairy'
  | 'grains'
  | 'grocery'
  | 'bakery'
  | 'frozen'
  | 'ready'
  | 'other';

export const NUTRIENT_KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** Пищевая ценность; null — значение неизвестно (не ноль!). */
export type Nutrients = Record<NutrientKey, number | null>;

/** Откуда взялись значения пищевой ценности. */
export type NutrientSource = 'source' | 'calculated' | 'estimate' | 'missing';

export interface Ingredient {
  id: string;
  name: string;
  /** Базовая единица учёта продукта. */
  unit: Unit;
  state: FoodState;
  department: Department;
  /** Пищевая ценность на 100 г или 100 мл (для unit 'g' | 'ml'). */
  per100?: Nutrients;
  /** Пищевая ценность на 1 шт (для unit 'pcs'). */
  perPiece?: Nutrients;
  /** Масса одной штуки в граммах — нужна, чтобы считать штуки в граммах. */
  pieceGrams?: number;
  /** Плотность г/мл — нужна, чтобы переводить граммы в миллилитры. */
  density?: number;
  nutrientSource?: NutrientSource;
  nutrientRef?: string;
}

export interface RecipeIngredient {
  ingredientId: string;
  amount: number;
  unit: Unit;
  /** Количество «по вкусу» не превращается в точные граммы. */
  toTaste?: boolean;
}

export type MealType = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export type DietMode = 'economy' | 'tasty' | 'no_cook' | 'smart_mix';

export interface Recipe {
  id: string;
  name: string;
  /** На сколько порций указаны ингредиенты. */
  servings: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  timeTotalMin: number;
  timeActiveMin: number;
  modes: DietMode[];
  mealTypes: MealType[];
  equipment: string[];
  source: string;
  verified: boolean;
}

export interface Package {
  ingredientId: string;
  /** Количество в одной упаковке, в базовой единице продукта. */
  size: number;
  /** Цена упаковки, если известна. */
  price?: number;
  store?: string;
  priceDate?: string;
}
