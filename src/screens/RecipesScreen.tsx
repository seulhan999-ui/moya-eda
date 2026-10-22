import { useMemo, useState } from 'react';
import { INGREDIENT_MAP, MEAL_LABEL, RECIPES } from '../catalog';
import type { MealType } from '../core/types';
import type { Recipe } from '../core/types';
import { balances, type StockMovement } from '../core/stock';
import { toBaseUnit } from '../core/units';
import type { SyncSession } from '../data/client';
import type { Row } from '../data/tables';
import { Obj, useRows, useToast } from '../ui/kit';
import { iconUrl } from '../ui/icons';
import { RecipeSheet } from './RecipeSheet';
import { formatMinutes } from '../ui/format';

type Filter = { id: string; label: string; test: (r: Recipe, ctx: Ctx) => boolean };
interface Ctx { ratings: Map<string, Row>; stock: Map<string, number> }

const FILTERS: Filter[] = [
  { id: 'all', label: 'Все', test: () => true },
  { id: 'fast10', label: 'до 10 мин', test: (r) => r.timeActiveMin <= 10 && r.timeTotalMin <= 15 },
  { id: 'fast20', label: 'до 20 мин', test: (r) => r.timeTotalMin <= 20 },
  { id: 'home', label: 'Из запасов', test: (r, c) => canCookFromStock(r, c.stock) },
  { id: 'nostove', label: 'Без плиты', test: (r) => r.equipment.every((e) => e === 'none' || e === 'microwave' || e === 'blender') },
  { id: 'fav', label: 'Избранное', test: (r, c) => !!c.ratings.get(r.id)?.favorite },
  { id: 'economy', label: 'Экономно', test: (r) => r.modes.includes('economy') },
  { id: 'tasty', label: 'Вкусно и разнообразно', test: (r) => r.modes.includes('tasty') },
  { id: 'no_cook', label: 'Почти без готовки', test: (r) => r.modes.includes('no_cook') },
];

export function canCookFromStock(r: Recipe, stock: Map<string, number>): boolean {
  return r.ingredients.every((ri) => {
    if (ri.toTaste) return true;
    const ing = INGREDIENT_MAP.get(ri.ingredientId)!;
    return (stock.get(ing.id) ?? 0) >= toBaseUnit(ri.amount / r.servings, ri.unit, ing) - 1e-9;
  });
}

export function RecipesScreen({ session, owner }: { session: SyncSession; owner: string }) {
  const [ratingRows] = useRows(session, 'taste_ratings');
  const [prefs] = useRows(session, 'food_preferences');
  const [moves] = useRows(session, 'stock_movements');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [meal, setMeal] = useState<MealType | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const ratings = useMemo(() => new Map(ratingRows.map((r) => [String(r.recipe_id), r])), [ratingRows]);
  const excluded = useMemo(() => new Set(prefs.filter((p) => p.kind === 'exclude').map((p) => String(p.ingredient_id))), [prefs]);
  const stock = useMemo(() => balances(moves.map(toMovement)), [moves]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter)!;
    return RECIPES.filter((r) => {
      if (ratings.get(r.id)?.never_suggest) return false;
      if (r.ingredients.some((ri) => excluded.has(ri.ingredientId))) return false;
      if (meal !== 'all' && !r.mealTypes.includes(meal)) return false;
      if (!f.test(r, { ratings, stock })) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.ingredients.some((ri) => INGREDIENT_MAP.get(ri.ingredientId)!.name.toLowerCase().includes(q));
    });
  }, [query, filter, meal, ratings, excluded, stock]);

  const hiddenByExclusion = RECIPES.filter((r) => r.ingredients.some((ri) => excluded.has(ri.ingredientId))).length;
  const favCount = ratingRows.filter((r) => r.favorite).length;
  const open = openId ? RECIPES.find((r) => r.id === openId) ?? null : null;

  return (
    <div className="page">
      <header className="top">
        <div><div className="date">личная коллекция</div><h1>Рецепты</h1></div>
        <div className="kb"><b>{RECIPES.length}<small>рецепта</small></b><div>{favCount} в избранном</div></div>
      </header>

      <label className="search">
        <img src={iconUrl('Magnifying glass tilted left')} alt="" />
        <input placeholder="Блюдо или продукт" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="seg meals">
        {(['all', 'breakfast', 'lunch', 'dinner', 'snack'] as const).map((m) => (
          <button key={m} className={meal === m ? 'on' : ''} onClick={() => setMeal(m)}>{m === 'all' ? 'Все' : MEAL_LABEL[m]}</button>
        ))}
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} className={`pill-btn ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      <div className="label">
        <span>{visible.length} {plural(visible.length, 'рецепт', 'рецепта', 'рецептов')}</span>
        {hiddenByExclusion > 0 && <span>{hiddenByExclusion} скрыто из-за исключений</span>}
      </div>

      {visible.length === 0 ? (
        <div className="card pad empty">
          <Obj name="Magnifying glass tilted left" size={72} />
          <p className="note">Ничего не нашлось. {filter === 'home' ? 'Отметьте продукты дома в «Корзине» — появятся блюда из запасов.' : 'Попробуйте другой фильтр.'}</p>
        </div>
      ) : (
        <section className="rgrid">
          {visible.map((r) => {
            const rt = ratings.get(r.id);
            return (
              <button key={r.id} className="rc" onClick={() => setOpenId(r.id)}>
                {!rt?.rating && <span className="rc-new">новое</span>}
                {rt?.favorite ? <span className="rc-fav">♥</span> : null}
                <Obj name={r.icon ?? 'Pot of food'} size={116} />
                <b>{r.name}</b>
                <span className="rc-meta">{formatMinutes(r.timeTotalMin)}{r.timeActiveMin < r.timeTotalMin ? ` · активно ${r.timeActiveMin}` : ''}</span>
              </button>
            );
          })}
        </section>
      )}

      <div className="import card">
        <Obj name="Memo" size={54} />
        <div><b>Добавить из PDF-книги</b><span>Появится на этапе 8: на компьютере, с проверкой каждого рецепта.</span></div>
      </div>

      <RecipeSheet
        recipe={open}
        session={session}
        owner={owner}
        rating={open ? ratings.get(open.id) : undefined}
        stock={stock}
        onClose={() => setOpenId(null)}
        toast={showToast}
      />
      {toast}
    </div>
  );
}

export function toMovement(r: Row): StockMovement {
  return { opId: String(r.op_id), ingredientId: String(r.ingredient_id), delta: Number(r.delta), kind: r.kind as StockMovement['kind'], refId: r.ref_id as string | undefined, at: String(r.at) };
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
