import { useEffect, useRef, useState } from 'react';
import { INGREDIENT_MAP, INGREDIENT_ICON, MEAL_LABEL, formatQty } from '../catalog';
import { recipeNutrition } from '../core/nutrition';
import type { Recipe } from '../core/types';
import { toBaseUnit } from '../core/units';
import type { SyncSession } from '../data/client';
import { photoUrl, uploadRecipePhoto } from '../data/photos';
import type { Row } from '../data/tables';
import { iconUrl } from '../ui/icons';
import { Obj, Sheet } from '../ui/kit';
import { formatMinutes } from '../ui/format';

const RATINGS = [
  { v: 'tasty', label: 'Вкусно' },
  { v: 'ok', label: 'Нормально' },
  { v: 'bad', label: 'Не понравилось' },
] as const;

interface Props {
  recipe: Recipe | null;
  session: SyncSession;
  owner: string;
  rating?: Row;
  stock: Map<string, number>;
  onClose: () => void;
  toast: (text: string, undo?: () => void) => void;
}

export function RecipeSheet({ recipe, session, owner, rating, stock, onClose, toast }: Props) {
  const [portions, setPortions] = useState(1);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPortions(1), [recipe?.id]);
  useEffect(() => {
    setPhoto(null);
    const path = rating?.photo_path as string | undefined;
    if (path) void photoUrl(path).then(setPhoto);
  }, [rating?.photo_path, recipe?.id]);

  async function saveRating(patch: Row) {
    if (!recipe) return;
    const base = rating ?? { recipe_id: recipe.id, rating: null, favorite: false, never_suggest: false };
    await session.engine.save('taste_ratings', { ...base, ...patch });
    void session.engine.sync();
  }

  async function onPhoto(file: File | undefined) {
    if (!file || !recipe) return;
    setBusy(true);
    try {
      const path = await uploadRecipePhoto(owner, recipe.id, file);
      await saveRating({ photo_path: path });
      toast('Фото сохранено — будет видно и на другом устройстве');
    } catch (e) {
      toast('Не удалось сохранить фото: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!recipe) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const t = recipeNutrition(recipe, INGREDIENT_MAP, portions);
  const estimate = recipe.ingredients.some((ri) => !ri.toTaste && INGREDIENT_MAP.get(ri.ingredientId)?.nutrientSource === 'estimate');
  const k = portions / recipe.servings;
  const n = (v: number | null) => (v === null ? '—' : String(Math.round(v)));

  return (
    <Sheet open onClose={onClose}>
      <div className="r-hero">
        {photo ? <img className="r-photo" src={photo} alt={recipe.name} /> : <Obj name={recipe.icon ?? 'Pot of food'} size={200} float />}
      </div>
      <button className="r-photo-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Сохраняю фото…' : photo ? 'Заменить фото' : 'Заглушка · добавить своё фото'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="r-kind">{recipe.mealTypes.map((m) => MEAL_LABEL[m]).join(' · ')}</div>
      <h2 className="r-title">{recipe.name}</h2>
      <div className="r-src">{recipe.source} · проверено</div>

      <div className="r-times">
        <div><b>{formatMinutes(recipe.timeTotalMin)}</b>всего</div>
        <div><b>{recipe.timeActiveMin} мин</b>активно</div>
        <div><b className="unk">—</b>цена неизвестна</div>
      </div>
      {recipe.passive && <p className="note center">Пассивное время: {recipe.passive}</p>}

      <div className="stepper">
        <span>Порции</span>
        <div>
          <button aria-label="Меньше" onClick={() => setPortions((p) => Math.max(0.5, p - (p > 1 ? 1 : 0.5)))}>−</button>
          <b>{String(portions).replace('.', ',')}</b>
          <button aria-label="Больше" onClick={() => setPortions((p) => Math.min(10, p < 1 ? 1 : p + 1))}>+</button>
        </div>
      </div>

      <div className="nut">
        <div><b>{n(t.kcal.value)}</b>ккал</div>
        <div><b>{n(t.protein.value)}</b>белки, г</div>
        <div><b>{n(t.fat.value)}</b>жиры, г</div>
        <div><b>{n(t.carbs.value)}</b>углев., г</div>
        <div><b>{n(t.fiber.value)}</b>клетч., г</div>
      </div>
      <p className="nsrc">
        На {String(portions).replace('.', ',')} {portions === 1 ? 'порцию' : portions < 5 ? 'порции' : 'порций'} · расчёт по ингредиентам, USDA FoodData Central
        {estimate && '. Часть продуктов — оценка по ближайшему аналогу'}
      </p>

      <div className="h5">Ингредиенты</div>
      {recipe.ingredients.map((ri) => {
        const ing = INGREDIENT_MAP.get(ri.ingredientId)!;
        if (ri.toTaste) {
          return (
            <div key={ri.ingredientId} className="ing">
              <img src={iconUrl(INGREDIENT_ICON[ing.id])} alt="" /><span>{ing.name}<small>по вкусу</small></span>
            </div>
          );
        }
        const need = toBaseUnit(ri.amount * k, ri.unit, ing);
        const have = stock.get(ing.id) ?? 0;
        const state = ing.state === 'dry' ? ' сухого' : ing.state === 'raw' && ing.department === 'meat_fish' ? ' сырого' : '';
        return (
          <div key={ri.ingredientId} className="ing">
            <img src={iconUrl(INGREDIENT_ICON[ing.id])} alt="" />
            <span>{ing.name}<small>{formatQty(ri.amount * k, ri.unit)}{state}</small></span>
            {have >= need - 1e-9 ? <span className="have yes">есть дома</span> : <span className="have no">{have > 0 ? `докупить ${formatQty(need - have, ing.unit)}` : 'докупить'}</span>}
          </div>
        );
      })}
      {recipe.cheaper && <div className="cheap">{recipe.cheaper}</div>}

      <div className="h5">Приготовление</div>
      <ol className="steps">{recipe.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>

      <div className="rate">
        {RATINGS.map((r) => (
          <button key={r.v} className={rating?.rating === r.v ? 'on' : ''} onClick={() => void saveRating({ rating: rating?.rating === r.v ? null : r.v })}>{r.label}</button>
        ))}
      </div>
      <button className={`fav-btn ${rating?.favorite ? 'on' : ''}`} onClick={() => void saveRating({ favorite: !rating?.favorite })}>
        {rating?.favorite ? '♥ В избранном' : '♡ В избранное'}
      </button>
      <button
        className="never"
        onClick={() => {
          void saveRating({ never_suggest: true });
          onClose();
          toast(`«${recipe.name}» больше не предлагается`, () => void saveRating({ never_suggest: false }));
        }}
      >
        Больше не предлагать
      </button>
    </Sheet>
  );
}
