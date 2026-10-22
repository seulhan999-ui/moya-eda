import { useMemo, useState } from 'react';
import { INGREDIENT_MAP, MEAL_LABEL, MODE_LABEL, RECIPES, RECIPE_MAP } from '../catalog';
import { calcNorm, type Activity, type Sex } from '../core/norms';
import { recipeNutrition } from '../core/nutrition';
import { addDays, mondayOf, planWeek, suggestNew, type Day, type PlanInput, type Slot, type Variant } from '../core/planner';
import { balances } from '../core/stock';
import type { DietMode, Equipment, MealType } from '../core/types';
import type { SyncSession } from '../data/client';
import { uuid } from '../data/ids';
import type { Row } from '../data/tables';
import { Obj, Sheet, useRows, useToast } from '../ui/kit';
import { iconUrl } from '../ui/icons';
import { RecipeSheet } from './RecipeSheet';
import { toMovement } from './RecipesScreen';

interface PlanDoc {
  list: Variant[];
  active: Day[] | null;
  activeVariant: number | null;
}

type View = 'active' | 0 | 1 | 2;

const MODES: { v: DietMode; icon: string }[] = [
  { v: 'economy', icon: 'Coin' },
  { v: 'tasty', icon: 'Fork and knife with plate' },
  { v: 'no_cook', icon: 'Stopwatch' },
  { v: 'smart_mix', icon: 'Sparkles' },
];
const LETTER = ['А', 'Б', 'В'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const ORDER: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];

const todayStr = () => new Date().toLocaleDateString('sv-SE');
const kcalOf = (id: string | null, portions = 1) => (id ? recipeNutrition(RECIPE_MAP.get(id)!, INGREDIENT_MAP, portions) : null);

export function MenuScreen({ session, owner, onCart }: { session: SyncSession; owner: string; onCart: () => void }) {
  const { engine } = session;
  const [plans] = useRows(session, 'meal_plans');
  const [profiles] = useRows(session, 'profiles');
  const [prefs] = useRows(session, 'food_preferences');
  const [ratingRows] = useRows(session, 'taste_ratings');
  const [weights] = useRows(session, 'weight_entries');
  const [moves] = useRows(session, 'stock_movements');
  const [week, setWeek] = useState(mondayOf(todayStr()));
  const [view, setView] = useState<View | null>(null);
  const [dayIdx, setDayIdx] = useState(() => Math.min(6, Math.max(0, dayDiff(mondayOf(todayStr()), todayStr()))));
  const [swap, setSwap] = useState<{ day: number; slot: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const profile: Row = profiles[0] ?? {};
  const mode = (profile.mode as DietMode) ?? 'smart_mix';
  const ratings = useMemo(() => new Map(ratingRows.map((r) => [String(r.recipe_id), r])), [ratingRows]);
  const stock = useMemo(() => balances(moves.map(toMovement)), [moves]);
  const planRow = plans.find((p) => p.week_start === week);
  const doc = planRow?.variants as PlanDoc | undefined;
  const current: View = view ?? (doc?.active ? 'active' : 0);
  const shown: Day[] | null = doc ? (current === 'active' ? doc.active : doc.list[current]?.days ?? null) : null;

  const lastWeight = [...weights].sort((a, b) => String(a.day).localeCompare(String(b.day))).pop();
  const norm = calcNorm({ age: profile.age as number, sex: profile.sex as Sex, heightCm: profile.height_cm as number, weightKg: lastWeight ? Number(lastWeight.kg) : null, activity: profile.activity as Activity, medical: !!profile.medical_note });

  function planInput(m: DietMode, pins: Map<string, string>, seed: number): PlanInput {
    return {
      recipes: RECIPES, ingredients: INGREDIENT_MAP, mode: m, weekStart: week,
      exclude: new Set(prefs.filter((p) => p.kind === 'exclude').map((p) => String(p.ingredient_id))),
      likes: new Set(prefs.filter((p) => p.kind === 'like').map((p) => String(p.ingredient_id))),
      dislikes: new Set(prefs.filter((p) => p.kind === 'dislike').map((p) => String(p.ingredient_id))),
      tastes: new Map(ratingRows.map((r) => [String(r.recipe_id), { rating: r.rating as 'tasty' | 'ok' | 'bad' | null, favorite: !!r.favorite, never: !!r.never_suggest }])),
      equipment: ((profile.equipment as Equipment[]) ?? ['stove', 'microwave']),
      maxCookMin: Number(profile.max_cook_min ?? 20), pins, seed, targetKcal: norm.ok ? norm.kcal : null,
    };
  }

  async function saveDoc(next: PlanDoc, m: DietMode, undoText?: string) {
    const prev = planRow;
    const row = { ...(planRow ?? { id: uuid(), week_start: week }), owner, mode: m, variants: next, active_variant: next.activeVariant };
    await engine.save('meal_plans', row);
    void engine.sync();
    if (undoText && prev) showToast(undoText, () => void engine.save('meal_plans', { ...prev }).then(() => engine.sync()));
  }

  /** Составить или обновить меню: закреплённые и прошедшие дни сохраняются. */
  async function generate(m: DietMode, text: string) {
    const today = todayStr();
    const pins = new Map<string, string>();
    for (const d of doc?.active ?? []) for (const s of d.meals) {
      if (s.recipeId && (s.pinned || d.date < today)) pins.set(`${d.date}:${s.type}`, s.recipeId);
    }
    const { variants } = planWeek(planInput(m, pins, Date.now() % 100000));
    let active: Day[] | null = null;
    if (doc?.active) {
      const base = variants[doc.activeVariant ?? 0].days;
      active = doc.active.map((d, i) => (d.date < today ? d : mergeDay(d, base[i])));
    }
    await saveDoc({ list: variants, active, activeVariant: doc?.activeVariant ?? null }, m, doc ? text : undefined);
    if (!doc) setView(0);
  }

  async function chooseVariant(v: number) {
    if (!doc) return;
    await saveDoc({ ...doc, active: structuredClone(doc.list[v].days), activeVariant: v }, mode, `Неделя собрана из варианта ${LETTER[v]}`);
    setView('active');
    showToast(`Вариант ${LETTER[v]} выбран — это теперь ваша неделя`);
  }

  async function setMode(m: DietMode) {
    await engine.save('profiles', { ...profile, owner, mode: m });
    if (doc) await generate(m, `Режим «${MODE_LABEL[m]}»: меню подобрано заново`);
    void engine.sync();
  }

  async function editActive(fn: (days: Day[]) => void, undoText?: string) {
    if (!doc) return;
    const days = structuredClone(doc.active ?? doc.list[current as number].days);
    fn(days);
    await saveDoc({ ...doc, active: days, activeVariant: doc.activeVariant ?? (current === 'active' ? null : (current as number)) }, mode, undoText);
    setView('active');
  }

  const days = shown ?? [];
  const day = days[dayIdx];
  const isActive = current === 'active';
  const range = fmtRange(week, addDays(week, 6));

  const dayTotals = day ? sumDay(day) : null;
  const avg = shown ? Math.round(shown.reduce((s, d) => s + (sumDay(d)?.kcal ?? 0), 0) / 7) : null;

  return (
    <div className="page">
      <header className="top">
        <div><div className="date">{range}</div><h1>Меню недели</h1></div>
        <div className="kb">{avg ? <><b>~{avg.toLocaleString('ru-RU')}<small>ккал</small></b><div>в день, в среднем</div></> : <><b>—</b><div>меню не составлено</div></>}</div>
      </header>

      <div className="weeknav">
        <button onClick={() => { setWeek(addDays(week, -7)); setView(null); }} aria-label="Прошлая неделя">‹</button>
        <span>{week === mondayOf(todayStr()) ? 'Эта неделя' : week > mondayOf(todayStr()) ? 'Следующая неделя' : 'Прошедшая неделя'}</span>
        <button onClick={() => { setWeek(addDays(week, 7)); setView(null); }} aria-label="Следующая неделя">›</button>
      </div>

      <section className="seg modes4">
        {MODES.map((m) => (
          <button key={m.v} className={mode === m.v ? 'on' : ''} onClick={() => void setMode(m.v)}>
            <img src={iconUrl(m.icon)} alt="" />{MODE_LABEL[m.v]}
          </button>
        ))}
      </section>

      {!doc ? (
        <section className="card pad soon">
          <Obj name="Spiral calendar" size={130} float />
          <b className="serif">Меню на эту неделю ещё нет</b>
          <p className="note">Составлю три варианта на 7 дней с учётом ваших вкусов, исключений, времени и техники.</p>
          <button className="btn btn-cu btn-full" onClick={() => void generate(mode, '')}>Составить меню</button>
        </section>
      ) : (
        <>
          <div className="label"><span>{doc.active ? 'Моя неделя и варианты' : 'Три варианта — выберите'}</span><button className="link" onClick={() => void generate(mode, 'Меню обновлено, закреплённые блюда сохранены')}>Обновить</button></div>
          <section className="vars">
            {doc.active && (
              <button className={`var ${current === 'active' ? 'on' : ''}`} onClick={() => setView('active')}>
                <div className="l">моя неделя</div><b>{doc.activeVariant !== null ? `Из варианта ${LETTER[doc.activeVariant]}` : 'Собрана вручную'}</b>
                <div className="ic">{iconsOf(doc.active).map((n, i) => <img key={i} src={iconUrl(n)} alt="" />)}</div>
              </button>
            )}
            {doc.list.map((v, i) => (
              <button key={i} className={`var ${current === i ? 'on' : ''}`} onClick={() => setView(i as View)}>
                <div className="l">вариант {LETTER[i]}</div><b>{v.title}</b>
                <div className="ic">{iconsOf(v.days).map((n, k) => <img key={k} src={iconUrl(n)} alt="" />)}</div>
              </button>
            ))}
          </section>

          {!isActive && (
            <div className="var-sum card pad">
              <span>{statsOf(doc.list[current as number].days)}</span>
              <button className="btn btn-cu btn-full" onClick={() => void chooseVariant(current as number)}>
                {doc.activeVariant === current && doc.active ? 'Взять заново этот вариант' : `Выбрать вариант ${LETTER[current as number]}`}
              </button>
            </div>
          )}

          <div className="days">
            {days.map((d, i) => (
              <button key={d.date} className={`day ${i === dayIdx ? 'on' : ''} ${d.date === todayStr() ? 'today' : ''}`} onClick={() => setDayIdx(i)}>
                {WD[i]}<b>{Number(d.date.slice(8))}</b>
              </button>
            ))}
          </div>

          {day && (
            <>
              <div className="label">
                <span>{WD_FULL[dayIdx]}{day.date === todayStr() ? ' · сегодня' : ''}</span>
                {dayTotals && <span>{Math.round(dayTotals.kcal)} ккал · белки {Math.round(dayTotals.protein)} г{norm.ok ? ` · норма ~${norm.kcal}` : ''}</span>}
              </div>
              <section className="card">
                {[...day.meals].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)).map((s) => {
                  const idx = day.meals.indexOf(s);
                  const r = s.recipeId ? RECIPE_MAP.get(s.recipeId) : null;
                  const t = kcalOf(s.recipeId, s.portions);
                  const past = day.date < todayStr();
                  return (
                    <div key={s.type} className="slot">
                      <button className="slot-main" onClick={() => r && setOpen(r.id)} disabled={!r}>
                        <Obj name={r?.icon ?? 'Prohibited'} size={58} />
                        <span className="grow">
                          <span className="k">{MEAL_LABEL[s.type]}{s.portions !== 1 ? ` · ${String(s.portions).replace('.', ',')} порц.` : ''}</span>
                          <b>{r?.name ?? 'Нет подходящего блюда'}</b>
                          <span className="k">{r ? `${t ? Math.round(t.kcal.value ?? 0) : '—'} ккал · ${r.timeTotalMin} мин` : s.note}</span>
                          {s.note && r && <span className="warn small">{s.note}</span>}
                        </span>
                      </button>
                      {!past && (
                        <>
                          <button className={`ib ${s.pinned ? 'pinned' : ''}`} aria-label={s.pinned ? 'Открепить' : 'Закрепить'}
                            onClick={() => void editActive((ds) => { ds[dayIdx].meals[idx].pinned = !s.pinned; }).then(() => showToast(s.pinned ? 'Закрепление снято' : 'Закреплено — сохранится при обновлении'))}>📌</button>
                          <button className="ib" aria-label="Заменить" onClick={() => setSwap({ day: dayIdx, slot: idx })}>⇄</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
              {day.date >= todayStr() && (
                day.meals.some((m) => m.type === 'snack') ? (
                  <button className="add-snack" onClick={() => void editActive((ds) => { ds[dayIdx].meals = ds[dayIdx].meals.filter((m) => m.type !== 'snack'); }, 'Перекус убран')}>− Убрать перекус</button>
                ) : (
                  <button className="add-snack" onClick={() => {
                    const p = planInput(mode, new Map(), Date.now());
                    const r = suggestNew('snack', p, new Set(day.meals.map((m) => m.recipeId!).filter(Boolean)), Date.now()) ?? RECIPES.find((x) => x.mealTypes.includes('snack'))!;
                    const alts = RECIPES.filter((x) => x.mealTypes.includes('snack') && x.id !== r.id).slice(0, 2).map((x) => x.id);
                    void editActive((ds) => { ds[dayIdx].meals.push({ type: 'snack', recipeId: r.id, alts, portions: 1 }); });
                  }}>+ Добавить перекус</button>
                )
              )}
            </>
          )}

          {!norm.ok && <p className="note small pad-x">Порции пока по 1 на приём. Заполните в «Профиле» возраст, пол, рост, вес и активность — подгоню порции и перекусы под вашу норму.</p>}
          <p className="note small pad-x">
            {profile.budget_week ? `Бюджет ${Number(profile.budget_week).toLocaleString('ru-RU')} ₽ в неделю · ` : ''}Стоимость пока не проверена: цены появятся после первых покупок в «Корзине».
          </p>
          <button className="btn btn-cu btn-full" onClick={onCart} disabled={!doc.active}>
            {doc.active ? 'Собрать продукты для моей недели' : 'Сначала выберите вариант недели'}
          </button>
        </>
      )}

      <Sheet open={swap !== null} onClose={() => setSwap(null)}>
        {swap && shown && (
          <SwapPanel
            slot={shown[swap.day].meals[swap.slot]}
            others={doc ? doc.list.map((v) => v.days[swap.day]?.meals.find((m) => m.type === shown[swap.day].meals[swap.slot].type)?.recipeId ?? null) : []}
            onNew={() => {
              const inWeek = new Set(shown.flatMap((d) => d.meals.map((m) => m.recipeId!)).filter(Boolean));
              return suggestNew(shown[swap.day].meals[swap.slot].type, planInput(mode, new Map(), Date.now()), inWeek, Date.now());
            }}
            onPick={(id) => {
              const old = shown[swap.day].meals[swap.slot];
              void editActive((ds) => {
                const s = ds[swap.day].meals[swap.slot];
                s.alts = [old.recipeId, ...old.alts].filter((x): x is string => !!x && x !== id).slice(0, 2);
                s.recipeId = id;
                s.note = undefined;
              }, 'Блюдо заменено');
              setSwap(null);
            }}
            onPortions={(p) => void editActive((ds) => { ds[swap.day].meals[swap.slot].portions = p; })}
          />
        )}
      </Sheet>

      <RecipeSheet recipe={open ? RECIPE_MAP.get(open) ?? null : null} session={session} owner={owner} rating={open ? ratings.get(open) : undefined} stock={stock} onClose={() => setOpen(null)} toast={showToast} />
      {toast}
    </div>
  );
}

function SwapPanel({ slot, others, onNew, onPick, onPortions }: {
  slot: Slot; others: (string | null)[]; onNew: () => ReturnType<typeof suggestNew>; onPick: (id: string) => void; onPortions: (p: number) => void;
}) {
  const [fresh, setFresh] = useState<string | null>(null);
  const cur = slot.recipeId ? RECIPE_MAP.get(slot.recipeId) : null;
  const options = [...new Set([...slot.alts, ...others.filter((x): x is string => !!x)])].filter((id) => id !== slot.recipeId);
  return (
    <>
      <div className="h5" style={{ marginTop: 4 }}>{MEAL_LABEL[slot.type]}</div>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 22 }}>{cur?.name ?? 'Нет блюда'}</div>
      <div className="stepper">
        <span>Порции</span>
        <div>
          <button onClick={() => onPortions(Math.max(0.5, slot.portions - (slot.portions > 1 ? 1 : 0.5)))}>−</button>
          <b>{String(slot.portions).replace('.', ',')}</b>
          <button onClick={() => onPortions(Math.min(10, slot.portions < 1 ? 1 : slot.portions + 1))}>+</button>
        </div>
      </div>
      <div className="h5">Можно заменить на</div>
      {[...(fresh ? [fresh] : []), ...options].map((id) => {
        const r = RECIPE_MAP.get(id)!;
        const t = kcalOf(id);
        return (
          <button key={id} className="alt-opt" onClick={() => onPick(id)}>
            <Obj name={r.icon ?? 'Pot of food'} size={56} />
            <span>{r.name}<small>{id === fresh ? 'новое для вас · ' : ''}{Math.round(t?.kcal.value ?? 0)} ккал · {r.timeTotalMin} мин</small></span>
          </button>
        );
      })}
      <button className="btn btn-ln btn-full" style={{ marginTop: 10 }} onClick={() => { const r = onNew(); setFresh(r ? r.id : null); }}>
        ✦ Хочу что-нибудь новое
      </button>
      <p className="note small center">После замены корзина пересчитается</p>
    </>
  );
}

function mergeDay(old: Day, fresh: Day): Day {
  const pinned = old.meals.filter((s) => s.pinned);
  const meals = fresh.meals.map((f) => pinned.find((s) => s.type === f.type) ?? f);
  for (const s of pinned) if (!meals.includes(s)) meals.push(s);
  return { date: old.date, meals };
}

function sumDay(d: Day): { kcal: number; protein: number } | null {
  let kcal = 0, protein = 0, any = false;
  for (const s of d.meals) {
    const t = kcalOf(s.recipeId, s.portions);
    if (!t) continue;
    any = true;
    kcal += t.kcal.value ?? 0;
    protein += t.protein.value ?? 0;
  }
  return any ? { kcal, protein } : null;
}

function iconsOf(days: Day[]): string[] {
  const out: string[] = [];
  for (const d of days) for (const s of d.meals) {
    const ic = s.recipeId ? RECIPE_MAP.get(s.recipeId)?.icon : undefined;
    if (ic && !out.includes(ic) && s.type !== 'breakfast') out.push(ic);
  }
  return out.slice(0, 3);
}

function statsOf(days: Day[]): string {
  const ids = days.flatMap((d) => d.meals.map((m) => m.recipeId)).filter((x): x is string => !!x);
  const uniq = new Set(ids).size;
  const avgTime = Math.round(ids.reduce((s, id) => s + RECIPE_MAP.get(id)!.timeActiveMin, 0) / ids.length);
  const protein = Math.round(days.reduce((s, d) => s + (sumDay(d)?.protein ?? 0), 0) / 7);
  return `${uniq} разных блюд · в среднем ${avgTime} мин активно · белки ~${protein} г в день · стоимость не проверена`;
}

function fmtRange(a: string, b: string): string {
  const month = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).split(' ')[1];
  const day = (d: string) => Number(d.slice(8));
  return month(a) === month(b) ? `${day(a)}–${day(b)} ${month(b)}` : `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000);
}
