// Составление меню на неделю: три варианта, две альтернативы на каждый приём пищи.
// Порядок: сначала обязательные исключения и совместимость (техника, тип приёма пищи),
// затем вкусы, режим, время, разнообразие и полезность.

import { recipeNutrition } from './nutrition';
import type { DietMode, Equipment, Ingredient, MealType, Recipe } from './types';

export interface Slot {
  type: MealType;
  recipeId: string | null;
  alts: string[];
  portions: number;
  pinned?: boolean;
  /** Почему слот пустой или почему ослаблены условия. */
  note?: string;
}

export interface Day {
  date: string; // YYYY-MM-DD
  meals: Slot[];
}

export interface Variant {
  title: string;
  days: Day[];
}

export interface Taste {
  rating?: 'tasty' | 'ok' | 'bad' | null;
  favorite?: boolean;
  never?: boolean;
}

export interface PlanInput {
  recipes: Recipe[];
  ingredients: Map<string, Ingredient>;
  mode: DietMode;
  weekStart: string;
  /** Продукты, исключённые всегда (аллергии и т.п.). */
  exclude: Set<string>;
  likes: Set<string>;
  dislikes: Set<string>;
  tastes: Map<string, Taste>;
  equipment: Equipment[];
  maxCookMin: number;
  /** Приёмы пищи по умолчанию (перекусы — по желанию). */
  mealTypes?: MealType[];
  /** Закреплённые блюда: ключ `${date}:${type}`. */
  pins?: Map<string, string>;
  seed?: number;
  /** Норма калорий в день, если рассчитана: порции и перекусы подгоняются под неё. */
  targetKcal?: number | null;
}

const DEFAULT_MEALS: MealType[] = ['breakfast', 'lunch', 'dinner'];
const MAX_REPEATS = 2;

/** Дата + n дней в формате YYYY-MM-DD (без часовых поясов). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Понедельник недели, в которую входит дата. */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 — воскресенье
  return addDays(date, -((wd + 6) % 7));
}

/** Какой режим действует для приёма пищи в «Умном миксе». */
export function modeFor(mode: DietMode, dayIndex: number, type: MealType): DietMode[] {
  if (mode !== 'smart_mix') return [mode];
  const weekend = dayIndex >= 5;
  if (type === 'breakfast') return weekend ? ['tasty', 'economy'] : ['no_cook', 'economy'];
  if (type === 'snack') return ['no_cook'];
  if (type === 'lunch') return weekend ? ['tasty', 'economy'] : ['economy', 'no_cook'];
  return weekend || dayIndex % 2 === 0 ? ['tasty', 'economy'] : ['economy', 'tasty'];
}

/** Обязательные ограничения: исключения, «больше не предлагать», техника. */
export function allowed(r: Recipe, p: Pick<PlanInput, 'exclude' | 'tastes' | 'equipment'>): boolean {
  if (p.tastes.get(r.id)?.never) return false;
  if (r.ingredients.some((ri) => p.exclude.has(ri.ingredientId))) return false;
  const have = new Set<Equipment>([...p.equipment, 'none']);
  return r.equipment.every((e) => have.has(e));
}

/** Детерминированный генератор случайных чисел (одинаковый результат при одинаковом seed). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

interface Scored { r: Recipe; score: number }

function baseScore(r: Recipe, p: PlanInput, health: Map<string, { protein: number; fiber: number; kcal: number }>): number {
  let s = 1;
  const t = p.tastes.get(r.id);
  if (t?.rating === 'tasty') s += 2;
  if (t?.rating === 'ok') s += 0.5;
  if (t?.rating === 'bad') s -= 2;
  if (t?.favorite) s += 1.5;
  for (const ri of r.ingredients) {
    if (p.likes.has(ri.ingredientId)) s += 1;
    if (p.dislikes.has(ri.ingredientId)) s -= 1.5;
  }
  const h = health.get(r.id);
  if (h && h.fiber >= 5) s += 0.5;
  if (h && h.protein >= 20 && !r.mealTypes.includes('snack')) s += 0.5;
  // Мягко сдерживаем перекос в белок (МР 2.3.1.0253-21: белки 12–14 % энергии).
  if (h && h.kcal > 0) s -= Math.max(0, (h.protein * 4) / h.kcal - 0.18) * 8;
  return s;
}

export interface PlanResult {
  variants: Variant[];
}

/** Составить три варианта меню на неделю. */
export function planWeek(p: PlanInput): PlanResult {
  const health = new Map(p.recipes.map((r) => {
    const t = recipeNutrition(r, p.ingredients, 1);
    return [r.id, { protein: t.protein.value ?? 0, fiber: t.fiber.value ?? 0, kcal: t.kcal.value ?? 0 }];
  }));
  const pool = p.recipes.filter((r) => allowed(r, p));
  const usedInVariants = new Map<string, number>();
  const variants: Variant[] = [];
  for (let v = 0; v < 3; v++) {
    const variant = planVariant(p, pool, health, v, usedInVariants);
    if (p.targetKcal) fitEnergy(variant, p, pool);
    variant.title = uniqueTitle(variant.days, p, variants.map((x) => x.title));
    variants.push(variant);
    for (const d of variant.days) for (const m of d.meals) if (m.recipeId) usedInVariants.set(m.recipeId, (usedInVariants.get(m.recipeId) ?? 0) + 1);
  }
  return { variants };
}

function planVariant(p: PlanInput, pool: Recipe[], health: Map<string, { protein: number; fiber: number; kcal: number }>, v: number, usedInVariants: Map<string, number>): Variant {
  const rand = rng((p.seed ?? 1) * 7919 + v * 104729 + 17);
  const used = new Map<string, number>();
  const days: Day[] = [];
  const meals = p.mealTypes ?? DEFAULT_MEALS;

  for (let i = 0; i < 7; i++) {
    const date = addDays(p.weekStart, i);
    const daySlots: Slot[] = [];
    const todayIds = new Set<string>();
    for (const type of meals) {
      const pinned = p.pins?.get(`${date}:${type}`);
      const ranked = rank(type, i, p, pool, health, used, usedInVariants, todayIds, rand);
      if (pinned) {
        daySlots.push({ type, recipeId: pinned, alts: ranked.filter((x) => x.r.id !== pinned).slice(0, 2).map((x) => x.r.id), portions: 1, pinned: true });
        used.set(pinned, (used.get(pinned) ?? 0) + 1);
        todayIds.add(pinned);
        continue;
      }
      if (ranked.length === 0) {
        daySlots.push({ type, recipeId: null, alts: [], portions: 1, note: 'Нет подходящих блюд: проверьте исключения и технику в профиле' });
        continue;
      }
      const pick = ranked[0].r;
      used.set(pick.id, (used.get(pick.id) ?? 0) + 1);
      todayIds.add(pick.id);
      const relaxed = pick.timeActiveMin > p.maxCookMin ? `Дольше вашего лимита (${pick.timeActiveMin} мин активно) — быстрее вариантов нет` : undefined;
      daySlots.push({ type, recipeId: pick.id, alts: ranked.slice(1, 3).map((x) => x.r.id), portions: 1, note: relaxed });
    }
    days.push({ date, meals: daySlots });
  }
  return { title: titleOf(days, p), days };
}

function rank(
  type: MealType, dayIndex: number, p: PlanInput, pool: Recipe[], health: Map<string, { protein: number; fiber: number; kcal: number }>,
  used: Map<string, number>, usedInVariants: Map<string, number>, todayIds: Set<string>, rand: () => number,
): Scored[] {
  const forType = pool.filter((r) => r.mealTypes.includes(type) && !todayIds.has(r.id) && (used.get(r.id) ?? 0) < MAX_REPEATS);
  const fast = forType.filter((r) => r.timeActiveMin <= p.maxCookMin);
  const base = fast.length ? fast : forType;
  const modes = modeFor(p.mode, dayIndex, type);
  return base
    .map((r) => {
      let score = baseScore(r, p, health);
      const mi = modes.findIndex((m) => r.modes.includes(m));
      score += mi === 0 ? 2 : mi === 1 ? 1 : -1.5; // блюда своего режима — в приоритете
      score -= 2.5 * (used.get(r.id) ?? 0); // разнообразие внутри недели
      score -= 0.9 * (usedInVariants.get(r.id) ?? 0); // варианты недели отличаются друг от друга
      score += rand() * 1.6; // немного случайности, чтобы меню не было одинаковым
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
}

const PROTEIN_GROUPS: [string, string[]][] = [
  ['Рыба', ['pollock', 'pink_salmon', 'tuna_can', 'shrimp']],
  ['Курица', ['chicken_breast', 'chicken_thigh', 'chicken_liver']],
  ['Мясо', ['beef_mince', 'turkey_mince']],
  ['Бобовые', ['lentils_red', 'chickpeas_can', 'beans_red_can', 'beans_white_can']],
  ['Крупы', ['buckwheat', 'bulgur', 'rice', 'couscous', 'barley']],
  ['Яйца', ['egg']],
  ['Творог', ['cottage']],
  ['Овощи', ['zucchini', 'broccoli', 'cauliflower', 'cabbage', 'pumpkin', 'eggplant', 'veg_mix_frozen']],
];

/** Название варианта, не совпадающее с уже выбранными названиями других вариантов. */
function uniqueTitle(days: Day[], p: PlanInput, taken: string[]): string {
  const groups = topGroups(days, p);
  const combos: string[] = [];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) combos.push(cap(`${groups[i]} и ${groups[j]}`));
  combos.push(...groups.map(cap));
  return combos.find((c) => !taken.includes(c)) ?? `${combos[0] ?? 'Разное'} (${taken.length + 1})`;
}

function cap(t: string): string {
  return t[0].toUpperCase() + t.slice(1);
}

function topGroups(days: Day[], p: PlanInput): string[] {
  const count = new Map<string, number>();
  const byId = new Map(p.recipes.map((r) => [r.id, r]));
  for (const d of days) for (const m of d.meals) {
    const r = m.recipeId ? byId.get(m.recipeId) : undefined;
    if (!r || m.type === 'breakfast') continue;
    for (const [g, ids] of PROTEIN_GROUPS) if (r.ingredients.some((ri) => ids.includes(ri.ingredientId))) count.set(g, (count.get(g) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g.toLowerCase());
}

/**
 * Подогнать энергию дня к норме: сначала перекус (если день заметно ниже нормы),
 * затем порции обеда и ужина шагом 0,5 (не больше 2). Закреплённые порции не трогаем.
 */
function fitEnergy(v: Variant, p: PlanInput, pool: Recipe[]): void {
  const target = p.targetKcal!;
  const kcal = (id: string | null, portions: number) => (id ? recipeNutrition(p.recipes.find((r) => r.id === id)!, p.ingredients, portions).kcal.value ?? 0 : 0);
  const dayKcal = (d: Day) => d.meals.reduce((s, m) => s + kcal(m.recipeId, m.portions), 0);
  const snacks = pool.filter((r) => r.mealTypes.includes('snack'));
  v.days.forEach((d, i) => {
    if (dayKcal(d) < target * 0.8 && !d.meals.some((m) => m.type === 'snack') && snacks.length) {
      const inDay = new Set(d.meals.map((m) => m.recipeId));
      const list = snacks.filter((r) => !inDay.has(r.id));
      const pick = list[(i * 3 + v.title.length) % list.length];
      const alts = list.filter((r) => r.id !== pick.id).slice(0, 2).map((r) => r.id);
      d.meals.splice(d.meals.length - 1, 0, { type: 'snack', recipeId: pick.id, alts, portions: 1 });
    }
    // Увеличиваем порции у блюд с меньшей долей белка, чтобы не перекосить рацион в белок
    // (МР 2.3.1.0253-21: белки 12–14 % энергии).
    const proteinShare = (id: string) => {
      const t = recipeNutrition(p.recipes.find((r) => r.id === id)!, p.ingredients, 1);
      return ((t.protein.value ?? 0) * 4) / Math.max(1, t.kcal.value ?? 1);
    };
    const tried = new Set<Slot>();
    for (let guard = 0; guard < 12 && dayKcal(d) < target * 0.9; guard++) {
      const cand = d.meals.filter((m) => !m.pinned && m.recipeId && m.portions < 2 && !tried.has(m));
      if (!cand.length) break;
      const m = cand.sort((a, b) => a.portions - b.portions || proteinShare(a.recipeId!) - proteinShare(b.recipeId!))[0];
      m.portions += 0.5;
      if (dayKcal(d) > target * 1.1) {
        m.portions -= 0.5;
        tried.add(m);
      }
    }
  });
}

/** Название варианта — по самым частым основным продуктам: «Рыба и крупы». */
function titleOf(days: Day[], p: PlanInput): string {
  const count = new Map<string, number>();
  const byId = new Map(p.recipes.map((r) => [r.id, r]));
  for (const d of days) for (const m of d.meals) {
    const r = m.recipeId ? byId.get(m.recipeId) : undefined;
    if (!r || m.type === 'breakfast') continue;
    for (const [g, ids] of PROTEIN_GROUPS) if (r.ingredients.some((ri) => ids.includes(ri.ingredientId))) count.set(g, (count.get(g) ?? 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g.toLowerCase());
  if (top.length === 0) return 'Разное';
  const t = top.join(' и ');
  return t[0].toUpperCase() + t.slice(1);
}

/** «Хочу что-нибудь новое»: блюдо, которое ещё не оценивали и которого нет в неделе. */
export function suggestNew(type: MealType, p: PlanInput, inWeek: Set<string>, seed = Date.now()): Recipe | null {
  const rand = rng(seed);
  const pool = p.recipes.filter((r) => allowed(r, p) && r.mealTypes.includes(type) && !inWeek.has(r.id) && !p.tastes.get(r.id)?.rating);
  if (pool.length === 0) return null;
  const fast = pool.filter((r) => r.timeActiveMin <= p.maxCookMin);
  const list = fast.length ? fast : pool;
  return list[Math.floor(rand() * list.length)];
}
