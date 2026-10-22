// Функции приложения, которые может вызвать ИИ-помощник. Все цифры — из данных приложения:
// модель только выбирает действие и параметры, а результат считает приложение.

import { matchesQuery } from '../catalog/search';
import { recipeNutrition } from '../core/nutrition';
import type { Ingredient, MealType, Recipe } from '../core/types';
import { toBaseUnit } from '../core/units';

export const FUNCTIONS = [
  {
    name: 'find_recipes',
    description: 'Найти блюда из каталога приложения: по продукту или названию, по времени готовки, по приёму пищи, из того, что есть дома, или что-то новое и необычное',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Продукт или блюдо, например «рыба», «курица рис». Пусто — без ограничения' },
        max_minutes: { type: 'number', description: 'Максимальное общее время готовки в минутах' },
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'snack', 'dinner'], description: 'Приём пищи' },
        from_stock: { type: 'boolean', description: 'Только из продуктов, которые есть дома (холодильник)' },
        unusual: { type: 'boolean', description: 'Новое, необычное, ещё не пробованное блюдо' },
      },
    },
  },
  {
    name: 'mark_meal',
    description: 'Отметить приём пищи сегодня в дневнике: съел или пропустил. Приложение попросит пользователя подтвердить',
    parameters: {
      type: 'object',
      properties: {
        meal: { type: 'string', enum: ['breakfast', 'lunch', 'snack', 'dinner'] },
        status: { type: 'string', enum: ['eaten', 'skipped'] },
      },
      required: ['meal', 'status'],
    },
  },
  {
    name: 'shopping_summary',
    description: 'Собрать продукты на неделю: сколько и что нужно купить по выбранному меню недели, известная сумма',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'cheaper_options',
    description: 'Найти, как сделать дешевле: советы по замене дорогих продуктов в блюдах недели и недорогие блюда',
    parameters: { type: 'object', properties: {} },
  },
] as const;

export interface ToolContext {
  recipes: Recipe[];
  ingredients: Map<string, Ingredient>;
  stock: Map<string, number>;
  exclude: Set<string>;
  never: Set<string>;
  rated: Set<string>;
  /** Блюда выбранной недели (id рецептов) — для советов «дешевле». */
  weekRecipes: string[];
  shopping: () => { hasPlan: boolean; toBuy: number; knownSum: number; unpriced: number; examples: string[] };
}

export type ToolResult =
  | { kind: 'recipes'; items: { id: string; name: string; minutes: number; kcal: number; atHome: number }[]; note?: string }
  | { kind: 'confirm'; meal: MealType; status: 'eaten' | 'skipped' }
  | { kind: 'shopping'; hasPlan: boolean; toBuy: number; knownSum: number; unpriced: number; examples: string[] }
  | { kind: 'cheaper'; tips: { recipe: string; tip: string }[]; economy: { id: string; name: string }[] }
  | { kind: 'error'; message: string };

const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'];

/** Доля ингредиентов рецепта (кроме «по вкусу»), которых дома хватает на 1 порцию. */
export function homeShare(r: Recipe, stock: Map<string, number>, ingredients: Map<string, Ingredient>): number {
  const list = r.ingredients.filter((ri) => !ri.toTaste);
  if (list.length === 0) return 0;
  const ok = list.filter((ri) => (stock.get(ri.ingredientId) ?? 0) >= toBaseUnit(ri.amount / r.servings, ri.unit, ingredients.get(ri.ingredientId)!) - 1e-9);
  return ok.length / list.length;
}

export function runTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolResult {
  const args = (typeof rawArgs === 'string' ? safeParse(rawArgs) : rawArgs ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'find_recipes': {
      const allowed = ctx.recipes.filter((r) => !ctx.never.has(r.id) && !r.ingredients.some((ri) => ctx.exclude.has(ri.ingredientId)));
      let list = allowed;
      const q = usefulQuery(typeof args.query === 'string' ? args.query : '', allowed);
      if (q) list = list.filter((r) => matchesQuery(r, q));
      const max = Number(args.max_minutes);
      if (max > 0) list = list.filter((r) => r.timeTotalMin <= max);
      if (typeof args.meal_type === 'string' && MEALS.includes(args.meal_type)) list = list.filter((r) => r.mealTypes.includes(args.meal_type as MealType));
      if (args.unusual) list = list.filter((r) => !ctx.rated.has(r.id)).sort((a, b) => Number(b.modes.includes('tasty')) - Number(a.modes.includes('tasty')));
      let note: string | undefined;
      const scored = list.map((r) => ({ r, share: homeShare(r, ctx.stock, ctx.ingredients) }));
      let picked = scored;
      if (args.from_stock) {
        const full = scored.filter((x) => x.share >= 1);
        if (full.length) picked = full;
        else {
          picked = scored.filter((x) => x.share >= 0.5).sort((a, b) => b.share - a.share);
          note = picked.length ? 'Полностью из запасов ничего не нашлось — вот блюда, для которых дома есть большая часть продуктов' : 'Дома мало отмеченных продуктов. Отметьте запасы в «Корзине» → «Есть дома»';
        }
      }
      const items = picked.slice(0, 5).map(({ r, share }) => ({
        id: r.id, name: r.name, minutes: r.timeTotalMin,
        kcal: Math.round(recipeNutrition(r, ctx.ingredients, 1).kcal.value ?? 0), atHome: Math.round(share * 100),
      }));
      if (!items.length && !note) note = 'Подходящих блюд в каталоге нет — попробуйте ослабить условия';
      return { kind: 'recipes', items, note };
    }
    case 'mark_meal': {
      const meal = String(args.meal);
      const status = args.status === 'eaten' ? 'eaten' : 'skipped';
      if (!MEALS.includes(meal)) return { kind: 'error', message: 'Не понял, какой приём пищи отметить' };
      return { kind: 'confirm', meal: meal as MealType, status };
    }
    case 'shopping_summary':
      return { kind: 'shopping', ...ctx.shopping() };
    case 'cheaper_options': {
      const byId = new Map(ctx.recipes.map((r) => [r.id, r]));
      const tips = [...new Set(ctx.weekRecipes)].map((id) => byId.get(id)).filter((r): r is Recipe => !!r?.cheaper).map((r) => ({ recipe: r.name, tip: r.cheaper! }));
      const economy = ctx.recipes.filter((r) => r.modes.includes('economy') && !ctx.never.has(r.id) && !r.ingredients.some((ri) => ctx.exclude.has(ri.ingredientId))).slice(0, 4).map((r) => ({ id: r.id, name: r.name }));
      return { kind: 'cheaper', tips, economy };
    }
    default:
      return { kind: 'error', message: 'Такого действия в приложении нет' };
  }
}

/** Оставить только слова запроса, которые встречаются хотя бы в одном блюде каталога. */
function usefulQuery(q: string, recipes: Recipe[]): string {
  return q
    .split(/[\s,]+/)
    .filter((w) => w.trim() && recipes.some((r) => matchesQuery(r, w)))
    .join(' ');
}

/** Текст ответа про блюда формирует приложение — модель не может назвать блюдо не из каталога. */
export function recipesText(r: Extract<ToolResult, { kind: 'recipes' }>, args: unknown): string {
  const a = (typeof args === 'string' ? safeParse(args) : args ?? {}) as Record<string, unknown>;
  if (!r.items.length) return r.note ?? 'Подходящих блюд не нашлось.';
  if (a.from_stock) return r.note ?? 'Вот что можно приготовить из того, что есть дома:';
  if (a.unusual) return 'Вот что вы ещё не пробовали:';
  if (Number(a.max_minutes) > 0) return `Вот что можно приготовить не дольше ${Number(a.max_minutes)} минут:`;
  return 'Вот что подходит:';
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Краткое описание результата для модели (без лишних данных). */
export function resultForModel(r: ToolResult): string {
  switch (r.kind) {
    case 'recipes': return JSON.stringify({ found: r.items.map((i) => ({ name: i.name, minutes: i.minutes, kcal: i.kcal, at_home_percent: i.atHome })), note: r.note ?? null });
    case 'confirm': return JSON.stringify({ waiting_user_confirmation: true, meal: r.meal, status: r.status });
    case 'shopping': return JSON.stringify(r.hasPlan ? { items_to_buy: r.toBuy, known_sum_rub: r.knownSum || null, items_without_price: r.unpriced, examples: r.examples } : { no_week_menu: true });
    case 'cheaper': return JSON.stringify({ tips: r.tips, cheap_dishes: r.economy.map((e) => e.name), prices_known: false });
    case 'error': return JSON.stringify({ error: r.message });
  }
}

export function systemPrompt(today: string, todayMeals: string, exclusions: string[]): string {
  return [
    'Ты — помощник приложения «Моя еда»: вкусное и полезное питание, простые рецепты, меню, покупки, дневник.',
    `Сегодня ${today}. Приёмы пищи сегодня: ${todayMeals || 'меню на сегодня не выбрано'}.`,
    exclusions.length ? `Исключённые продукты пользователя: ${exclusions.join(', ')}.` : '',
    'Правила: отвечай по-русски, коротко и дружелюбно (1–3 предложения).',
    'Чтобы предложить блюдо, всегда вызывай find_recipes; сам блюда не называй. В query пиши только продукты или названия блюд, без слов «вкусное», «быстро».',
    'Для покупок, экономии и отметок вызывай функции приложения и опирайся только на их результат.',
    'Никогда не придумывай цены, калории, наличие продуктов и рецепты — если данных нет, так и скажи.',
    'Если пользователь говорит, что пропустил или съел приём пищи, вызови mark_meal — приложение спросит подтверждение.',
    'Не давай медицинских назначений.',
  ].filter(Boolean).join('\n');
}
