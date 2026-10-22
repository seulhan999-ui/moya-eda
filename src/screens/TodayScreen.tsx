import { useMemo, useState } from 'react';
import { INGREDIENT_MAP, MEAL_LABEL, RECIPES, RECIPE_MAP } from '../catalog';
import { matchesQuery } from '../catalog/search';
import { batchLeftover, dayTotals, entryFor, findBatch, proposeRebalance, type Batch, type Entry } from '../core/diary';
import { calcNorm, type Activity, type Sex } from '../core/norms';
import { recipeNutrition, snapshot, type NutrientTotals } from '../core/nutrition';
import { addDays, mondayOf, type Day, type Slot } from '../core/planner';
import { balances, cook, reverse } from '../core/stock';
import type { MealType } from '../core/types';
import type { SyncSession } from '../data/client';
import { nowIso, uuid } from '../data/ids';
import type { Row } from '../data/tables';
import { Obj, Sheet, useRows, useToast } from '../ui/kit';
import { RecipeSheet } from './RecipeSheet';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { latestPrices, packagesFor } from '../core/prices';
import { buildShoppingList } from '../core/shopping';
import { INGREDIENTS, PACK_SIZE } from '../catalog';
import type { Unit } from '../core/types';
import { toMovement } from './RecipesScreen';

const ORDER: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const TIME: Record<MealType, string> = { breakfast: '08:00', lunch: '13:00', snack: '16:00', dinner: '19:00' };
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const kcalOf = (id: string, p: number) => recipeNutrition(RECIPE_MAP.get(id)!, INGREDIENT_MAP, p).kcal.value ?? 0;
const snap = (id: string, p: number) => snapshot(recipeNutrition(RECIPE_MAP.get(id)!, INGREDIENT_MAP, p));

type Ask = { slot: Slot; recipeId: string; status: 'eaten' | 'replaced'; portions: number };

export function TodayScreen({ session, owner, onMenu, onCart }: { session: SyncSession; owner: string; onMenu: () => void; onCart: () => void }) {
  const { engine } = session;
  const [plans] = useRows(session, 'meal_plans');
  const [entryRows] = useRows(session, 'food_entries');
  const [batchRows] = useRows(session, 'cook_batches');
  const [moves] = useRows(session, 'stock_movements');
  const [profiles] = useRows(session, 'profiles');
  const [weights] = useRows(session, 'weight_entries');
  const [ratingRows] = useRows(session, 'taste_ratings');
  const [prefs] = useRows(session, 'food_preferences');
  const [manualRows] = useRows(session, 'shopping_manual');
  const [priceRows] = useRows(session, 'store_prices');
  const [aiOpen, setAiOpen] = useState(false);
  const [day, setDay] = useState(todayStr());
  const [focus, setFocus] = useState<MealType | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [edit, setEdit] = useState<Entry | null>(null);
  const [sheet, setSheet] = useState<'offplan' | 'cook' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const entries: Entry[] = useMemo(() => entryRows.map(toEntry), [entryRows]);
  const batches: Batch[] = useMemo(() => batchRows.map((b) => ({ id: String(b.id), recipeId: String(b.recipe_id), portions: Number(b.portions), cookedAt: String(b.cooked_at) })), [batchRows]);
  const movements = useMemo(() => moves.map(toMovement), [moves]);
  const stock = useMemo(() => balances(movements), [movements]);
  const ratings = useMemo(() => new Map(ratingRows.map((r) => [String(r.recipe_id), r])), [ratingRows]);

  const profile: Row = profiles[0] ?? {};
  const lastW = [...weights].sort((a, b) => String(a.day).localeCompare(String(b.day))).pop();
  const norm = calcNorm({ age: profile.age as number, sex: profile.sex as Sex, heightCm: profile.height_cm as number, weightKg: lastW ? Number(lastW.kg) : null, activity: profile.activity as Activity, medical: !!profile.medical_note });

  const planRow = plans.find((p) => p.week_start === mondayOf(day));
  const doc = planRow?.variants as { active?: Day[] | null } | undefined;
  const planDay = doc?.active?.find((d) => d.date === day) ?? null;
  const slots = planDay ? [...planDay.meals].filter((m) => m.recipeId).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)) : [];

  const statusOf = (t: MealType) => entryFor(entries, day, t);
  const todayPlan = () => plans.find((p) => p.week_start === mondayOf(todayStr()))?.variants as { active?: Day[] | null } | undefined;
  const todaySlots = () => (todayPlan()?.active?.find((d) => d.date === todayStr())?.meals ?? []).filter((m) => m.recipeId);
  const firstOpen = slots.find((s) => !statusOf(s.type));
  const cur = (focus && slots.find((s) => s.type === focus && !statusOf(s.type))) || firstOpen || null;
  const totals = dayTotals(entries, day);
  const offPlan = entries.filter((e) => e.day === day && e.offPlan);

  // ---------- действия ----------
  async function writeEntry(e: Omit<Entry, 'id'> & { id?: string }, writeOff: boolean): Promise<string> {
    const id = e.id ?? uuid();
    const opId = uuid();
    await engine.save('food_entries', {
      id, op_id: opId, day: e.day, meal_type: e.mealType, status: e.status, recipe_id: e.recipeId, name: e.name, portions: e.portions,
      nutrition: e.nutrition, off_plan: e.offPlan, stock_written_off: writeOff, from_batch: e.fromBatch,
    });
    if (writeOff && e.recipeId) {
      for (const m of cook(id, RECIPE_MAP.get(e.recipeId)!, e.portions, INGREDIENT_MAP, nowIso())) {
        await engine.append('stock_movements', { op_id: m.opId, ingredient_id: m.ingredientId, delta: m.delta, kind: m.kind, ref_id: m.refId, at: m.at });
      }
    }
    void engine.sync();
    return id;
  }

  async function removeEntry(id: string) {
    const row = entryRows.find((r) => r.id === id);
    if (!row) return;
    if (row.stock_written_off) {
      for (const r of reverse(id, movements, nowIso())) {
        await engine.append('stock_movements', { op_id: r.opId, ingredient_id: r.ingredientId, delta: r.delta, kind: r.kind, ref_id: r.refId, at: r.at });
      }
    }
    await engine.remove('food_entries', row);
    void engine.sync();
  }

  /** «Съел» или «Заменил»: если блюдо приготовлено заранее — берём порцию оттуда, иначе спрашиваем про запасы. */
  async function eat(slot: Slot, recipeId: string, status: 'eaten' | 'replaced', portions: number) {
    const b = findBatch(recipeId, portions, batches, entries, day);
    if (b) {
      const id = await writeEntry(base(slot.type, status, recipeId, portions, b.id), false);
      afterMark(slot.type, status, id);
    } else {
      setAsk({ slot, recipeId, status, portions });
    }
  }

  async function answerAsk(writeOff: boolean) {
    if (!ask) return;
    const id = await writeEntry(base(ask.slot.type, ask.status, ask.recipeId, ask.portions, null), writeOff);
    afterMark(ask.slot.type, ask.status, id);
    setAsk(null);
  }

  async function skip(slot: Slot) {
    const id = await writeEntry({ day, mealType: slot.type, status: 'skipped', recipeId: slot.recipeId, name: null, portions: slot.portions, nutrition: null, offPlan: false, fromBatch: null, stockWrittenOff: false }, false);
    afterMark(slot.type, 'skipped', id);
  }

  function afterMark(type: MealType, status: string, id: string) {
    setFocus(null);
    setSwapOpen(false);
    setDismissed(null);
    const label = status === 'eaten' ? 'отмечено «Съел»' : status === 'replaced' ? 'отмечено «Заменил»' : 'пропущен';
    showToast(`${MEAL_LABEL[type]}: ${label}`, () => void removeEntry(id));
  }

  function base(type: MealType, status: 'eaten' | 'replaced', recipeId: string, portions: number, fromBatch: string | null): Omit<Entry, 'id'> {
    return { day, mealType: type, status, recipeId, name: null, portions, nutrition: snap(recipeId, portions), offPlan: false, fromBatch, stockWrittenOff: false };
  }

  async function cookNow(recipeId: string, portions: number) {
    const cookId = uuid();
    for (const m of cook(cookId, RECIPE_MAP.get(recipeId)!, portions, INGREDIENT_MAP, nowIso())) {
      await engine.append('stock_movements', { op_id: m.opId, ingredient_id: m.ingredientId, delta: m.delta, kind: m.kind, ref_id: m.refId, at: m.at });
    }
    await engine.save('cook_batches', { id: cookId, op_id: cookId, recipe_id: recipeId, portions, cooked_at: nowIso() });
    void engine.sync();
    setSheet(null);
    showToast(`Приготовлено ${fmtP(portions)} — продукты списаны один раз`, () => void undoCook(cookId));
  }

  async function undoCook(cookId: string) {
    for (const r of reverse(cookId, movements.concat(), nowIso())) {
      await engine.append('stock_movements', { op_id: r.opId, ingredient_id: r.ingredientId, delta: r.delta, kind: r.kind, ref_id: r.refId, at: r.at });
    }
    const b = batchRows.find((x) => x.id === cookId);
    if (b) await engine.remove('cook_batches', b);
    void engine.sync();
  }

  async function applyProposal(type: MealType, toId: string) {
    if (!planRow || !doc?.active) return;
    const prev = planRow;
    const days = structuredClone(doc.active);
    const s = days.find((d) => d.date === day)!.meals.find((m) => m.type === type)!;
    s.alts = [s.recipeId!, ...s.alts.filter((a) => a !== toId)].slice(0, 2);
    s.recipeId = toId;
    await engine.save('meal_plans', { ...planRow, variants: { ...doc, active: days } });
    void engine.sync();
    showToast(`${MEAL_LABEL[type]} заменён`, () => void engine.save('meal_plans', { ...prev }).then(() => engine.sync()));
  }

  // ---------- предложение поправить день ----------
  const hadChange = slots.some((s) => { const e = statusOf(s.type); return e && e.status !== 'eaten'; });
  const remaining = slots.filter((s) => !statusOf(s.type)).map((s) => ({ type: s.type, recipeId: s.recipeId!, alts: s.alts, portions: s.portions }));
  const proposal = hadChange && day === todayStr() ? proposeRebalance(totals.kcal.value ?? 0, remaining, norm.ok ? norm.kcal : null, kcalOf) : null;
  const showProposal = proposal && dismissed !== `${day}:${proposal.type}:${proposal.toId}`;

  const isToday = day === todayStr();
  const n = (t: NutrientTotals, k: keyof NutrientTotals) => (t[k].value === null ? '—' : String(Math.round(t[k].value!)));
  const incomplete = (['kcal', 'protein', 'fat', 'carbs'] as const).some((k) => !totals[k].complete);

  return (
    <div className="page">
      <header className="top">
        <div>
          <div className="date daynav">
            <button onClick={() => setDay(addDays(day, -1))} aria-label="Предыдущий день">‹</button>
            {new Date(day + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            {!isToday && <button onClick={() => setDay(addDays(day, 1))} aria-label="Следующий день">›</button>}
          </div>
          <h1>{isToday ? 'Сегодня' : day < todayStr() ? 'Прошедший день' : 'Будущий день'}</h1>
        </div>
        <div className="kb">
          <b>{incomplete && totals.kcal.value !== null ? '≈' : ''}{n(totals, 'kcal')}<small>ккал</small></b>
          <div>Б {n(totals, 'protein')} · Ж {n(totals, 'fat')} · У {n(totals, 'carbs')}</div>
        </div>
      </header>
      {!isToday && <button className="link" onClick={() => setDay(todayStr())}>Вернуться к сегодняшнему дню</button>}

      {!planDay ? (
        <section className="card pad soon">
          <Obj name="Spiral calendar" size={110} float />
          <b className="serif">{isToday ? 'На сегодня меню не выбрано' : 'В этот день меню не было'}</b>
          <p className="note">Выберите неделю в «Меню» — здесь появятся блюда дня. Еду можно записывать и без меню.</p>
          {isToday && <button className="btn btn-cu btn-full" onClick={onMenu}>Открыть меню</button>}
        </section>
      ) : (
        <>
          <nav className="steps-row" aria-label="Ход дня">
            {slots.map((s) => {
              const e = statusOf(s.type);
              const r = RECIPE_MAP.get(e?.recipeId ?? s.recipeId!)!;
              const st = e ? e.status : cur?.type === s.type ? 'cur' : 'wait';
              return (
                <button key={s.type} className={`step ${st}`} onClick={() => (e ? setEdit(e) : setFocus(s.type))}>
                  <Obj name={r.icon ?? 'Pot of food'} size={52} dim={!!e} />
                  <span className="s">{MEAL_LABEL[s.type]}</span>
                </button>
              );
            })}
          </nav>

          <div className="label"><span>{cur ? 'Сейчас' : 'День отмечен'}</span></div>
          {cur ? <NowCard slot={cur} onOpen={() => setOpen(cur.recipeId)} onEat={() => void eat(cur, cur.recipeId!, 'eaten', cur.portions)} onSwap={() => setSwapOpen(true)} onSkip={() => void skip(cur)} leftover={leftoverOf(cur.recipeId!, batches, entries, day)} />
            : (
              <section className="now done">
                <Obj name="Check mark button" size={110} float />
                <b className="serif">Всё отмечено</b>
                <span className="note">{norm.ok ? `Норма ~${norm.kcal.toLocaleString('ru-RU')} ккал` : 'Итог дня — вверху справа'}</span>
              </section>
            )}

          {showProposal && proposal && (
            <section className="tip-card">
              <Obj name="Light bulb" size={52} />
              <div>
                <b className="serif">Обновить остаток дня?</b>
                <p>{proposal.reason}: {MEAL_LABEL[proposal.type].toLowerCase()} — «{RECIPE_MAP.get(proposal.toId)!.name}» вместо «{RECIPE_MAP.get(proposal.fromId)!.name}».</p>
                <div className="row2">
                  <button className="btn btn-cu" onClick={() => void applyProposal(proposal.type, proposal.toId)}>Заменить</button>
                  <button className="btn btn-ln" onClick={() => setDismissed(`${day}:${proposal.type}:${proposal.toId}`)}>Оставить</button>
                </div>
              </div>
            </section>
          )}

          <div className="label"><span>Весь день</span><span>нажмите, чтобы изменить</span></div>
          <section className="card">
            {slots.map((s) => {
              const e = statusOf(s.type);
              const r = RECIPE_MAP.get(e?.recipeId ?? s.recipeId!)!;
              return (
                <button key={s.type} className="row" onClick={() => (e ? setEdit(e) : setFocus(s.type))}>
                  <Obj name={r.icon ?? 'Pot of food'} size={52} dim={!!e} />
                  <span className="t"><span className="k">{MEAL_LABEL[s.type]} · {TIME[s.type]}</span><b>{r.name}</b></span>
                  <Badge e={e} kcal={Math.round(kcalOf(s.recipeId!, s.portions))} />
                </button>
              );
            })}
          </section>
        </>
      )}

      {offPlan.length > 0 && (
        <>
          <div className="label"><span>Вне плана</span></div>
          <section className="card">
            {offPlan.map((e) => (
              <button key={e.id} className="row" onClick={() => setEdit(e)}>
                <Obj name={e.recipeId ? RECIPE_MAP.get(e.recipeId)?.icon ?? 'Bento box' : 'Bento box'} size={52} />
                <span className="t"><span className="k">{e.mealType ? MEAL_LABEL[e.mealType] : 'Перекус'}</span><b>{e.recipeId ? RECIPE_MAP.get(e.recipeId)?.name : e.name}</b></span>
                <span className="badge b-out">{e.nutrition?.kcal.value != null ? `${Math.round(e.nutrition.kcal.value)} ккал` : 'без данных'}</span>
              </button>
            ))}
          </section>
        </>
      )}

      <div className="label"><span>Быстро</span></div>
      <section className="quick">
        <button className="q" onClick={() => setSheet('offplan')}><Obj name="Bento box" size={54} />Еда<br />вне плана</button>
        <button className="q" onClick={() => setSheet('cook')}><Obj name="Cooking" size={54} />Приготовил<br />заранее</button>
        <button className="q" onClick={() => setAiOpen(true)}><Obj name="Speech balloon" size={54} />Спросить<br />помощника</button>
      </section>
      {incomplete && totals.kcal.value !== null && <p className="note small pad-x">≈ — итог неполный: у части записей нет данных о составе.</p>}

      {/* Замена блюда: альтернативы и поиск */}
      <Sheet open={swapOpen && !!cur} onClose={() => setSwapOpen(false)}>
        {cur && <PickRecipe title={`${MEAL_LABEL[cur.type]}: что съели вместо?`} suggestions={cur.alts} mealType={cur.type} onPick={(id, p) => void eat(cur, id, 'replaced', p)} />}
      </Sheet>

      {/* Списывать ли продукты */}
      <Sheet open={ask !== null} onClose={() => setAsk(null)}>
        {ask && (
          <>
            <Obj name="Cooking" size={100} float />
            <div className="r-title">Списать продукты из запасов?</div>
            <p className="note center">«{RECIPE_MAP.get(ask.recipeId)!.name}», {fmtP(ask.portions)}. Если готовили дома — продукты для этого блюда уберутся из «Есть дома».</p>
            <button className="btn btn-cu btn-full" onClick={() => void answerAsk(true)}>Да, готовил дома</button>
            <button className="btn btn-ln btn-full" style={{ marginTop: 8 }} onClick={() => void answerAsk(false)}>Нет — ел вне дома или запасы не веду</button>
          </>
        )}
      </Sheet>

      {/* Правка записи */}
      <Sheet open={edit !== null} onClose={() => setEdit(null)}>
        {edit && (
          <EditEntry
            e={edit}
            onPortions={async (p) => {
              const row = entryRows.find((r) => r.id === edit.id)!;
              await engine.save('food_entries', { ...row, portions: p, nutrition: edit.recipeId && edit.status !== 'skipped' ? snap(edit.recipeId, p) : row.nutrition });
              void engine.sync();
              setEdit({ ...edit, portions: p });
            }}
            onUnmark={async () => { await removeEntry(edit.id); setEdit(null); showToast('Отметка снята — приём снова «Не отмечено»'); }}
          />
        )}
      </Sheet>

      {/* Еда вне плана */}
      <Sheet open={sheet === 'offplan'} onClose={() => setSheet(null)}>
        {sheet === 'offplan' && (
          <OffPlan
            onRecipe={async (id, p) => {
              const eid = await writeEntry({ day, mealType: 'snack', status: 'eaten', recipeId: id, name: null, portions: p, nutrition: snap(id, p), offPlan: true, fromBatch: null, stockWrittenOff: false }, false);
              setSheet(null);
              showToast('Записано вне плана', () => void removeEntry(eid));
            }}
            onCustom={async (name, kcal) => {
              const nut = kcal === null ? null : customNutrition(kcal);
              const eid = await writeEntry({ day, mealType: 'snack', status: 'eaten', recipeId: null, name, portions: 1, nutrition: nut, offPlan: true, fromBatch: null, stockWrittenOff: false }, false);
              setSheet(null);
              showToast('Записано вне плана', () => void removeEntry(eid));
            }}
          />
        )}
      </Sheet>

      {/* Приготовил заранее */}
      <Sheet open={sheet === 'cook'} onClose={() => setSheet(null)}>
        {sheet === 'cook' && (
          <CookPanel
            planned={(doc?.active ?? []).filter((d) => d.date >= day).slice(0, 3).flatMap((d) => d.meals.map((m) => m.recipeId!)).filter(Boolean)}
            batches={batches.filter((b) => batchLeftover(b, entries) > 0)}
            onCook={(id, p) => void cookNow(id, p)}
          />
        )}
      </Sheet>

      <Sheet open={aiOpen} onClose={() => setAiOpen(false)}>
        {aiOpen && (
          <AssistantPanel
            today={new Date(todayStr() + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            todayMeals={todaySlots().map((s) => `${MEAL_LABEL[s.type]} — ${RECIPE_MAP.get(s.recipeId!)?.name} (${statusText(entryFor(entries, todayStr(), s.type)?.status)})`).join('; ')}
            exclusions={prefs.filter((p) => p.kind === 'exclude').map((p) => String(p.label))}
            ctx={{
              recipes: RECIPES, ingredients: INGREDIENT_MAP, stock,
              exclude: new Set(prefs.filter((p) => p.kind === 'exclude').map((p) => String(p.ingredient_id))),
              never: new Set(ratingRows.filter((r) => r.never_suggest).map((r) => String(r.recipe_id))),
              rated: new Set(ratingRows.filter((r) => r.rating).map((r) => String(r.recipe_id))),
              weekRecipes: (todayPlan()?.active ?? []).flatMap((d) => d.meals.map((m) => m.recipeId!)).filter(Boolean),
              shopping: () => shoppingSummary(todayPlan()?.active ?? null, stock, manualRows, priceRows),
            }}
            onOpenRecipe={(id) => setOpen(id)}
            onOpenCart={() => { setAiOpen(false); onCart(); }}
            onMark={async (meal, status) => {
              const slot = todaySlots().find((s) => s.type === meal);
              if (!slot) {
                await writeEntry({ day: todayStr(), mealType: meal, status, recipeId: null, name: null, portions: 1, nutrition: null, offPlan: false, fromBatch: null, stockWrittenOff: false }, false);
                return;
              }
              if (status === 'skipped') await skip(slot);
              else await eat(slot, slot.recipeId!, 'eaten', slot.portions);
            }}
          />
        )}
      </Sheet>

      <RecipeSheet recipe={open ? RECIPE_MAP.get(open) ?? null : null} session={session} owner={owner} rating={open ? ratings.get(open) : undefined} stock={stock} onClose={() => setOpen(null)} toast={showToast} />
      {toast}
    </div>
  );
}

function NowCard({ slot, onOpen, onEat, onSwap, onSkip, leftover }: { slot: Slot; onOpen: () => void; onEat: () => void; onSwap: () => void; onSkip: () => void; leftover: number }) {
  const r = RECIPE_MAP.get(slot.recipeId!)!;
  const t = recipeNutrition(r, INGREDIENT_MAP, slot.portions);
  const v = (k: keyof NutrientTotals) => Math.round(t[k].value ?? 0);
  return (
    <section className="now">
      <div className="now-head"><span>{MEAL_LABEL[slot.type]} · {TIME[slot.type]}</span>{slot.pinned && <span className="pin">📌 закреплено</span>}</div>
      <button className="now-pic" onClick={onOpen} aria-label="Открыть рецепт"><Obj name={r.icon ?? 'Pot of food'} size={200} float /></button>
      <h2>{r.name}</h2>
      <div className="kc">{v('kcal')} ккал · Б {v('protein')} · Ж {v('fat')} · У {v('carbs')}{slot.portions !== 1 ? ` · ${fmtP(slot.portions)}` : ''}</div>
      {leftover > 0 && <div className="kc ok">Приготовлено заранее: осталось {fmtP(leftover)}</div>}
      <button className="eat" onClick={onEat}>Съел</button>
      <div className="sec-acts"><button onClick={onSwap}>⇄ Заменил</button><button onClick={onSkip}>Пропустил</button></div>
    </section>
  );
}

function Badge({ e, kcal }: { e?: Entry; kcal: number }) {
  if (!e) return <span className="badge b-wait">{kcal} ккал</span>;
  if (e.status === 'skipped') return <span className="badge b-skip">Пропуск</span>;
  if (e.status === 'replaced') return <span className="badge b-out">Заменил</span>;
  return <span className="badge b-done">Съел{e.portions !== 1 ? ` ${fmtP(e.portions)}` : ''}</span>;
}

function PickRecipe({ title, suggestions, mealType, onPick }: { title: string; suggestions: string[]; mealType: MealType; onPick: (id: string, portions: number) => void }) {
  const [q, setQ] = useState('');
  const [p, setP] = useState(1);
  const found = q.trim() ? RECIPES.filter((r) => matchesQuery(r, q)).slice(0, 12).map((r) => r.id) : RECIPES.filter((r) => r.mealTypes.includes(mealType) && !suggestions.includes(r.id)).slice(0, 6).map((r) => r.id);
  const list = [...new Set([...(q.trim() ? [] : suggestions), ...found])];
  return (
    <>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 22 }}>{title}</div>
      <input className="input" placeholder="Найти блюдо или продукт" value={q} onChange={(e) => setQ(e.target.value)} />
      <Stepper value={p} onChange={setP} />
      {list.map((id) => {
        const r = RECIPE_MAP.get(id)!;
        return (
          <button key={id} className="alt-opt" onClick={() => onPick(id, p)}>
            <Obj name={r.icon ?? 'Pot of food'} size={52} />
            <span>{r.name}<small>{Math.round(kcalOf(id, p))} ккал</small></span>
          </button>
        );
      })}
    </>
  );
}

function OffPlan({ onRecipe, onCustom }: { onRecipe: (id: string, p: number) => void; onCustom: (name: string, kcal: number | null) => void }) {
  const [mode, setMode] = useState<'recipe' | 'custom'>('recipe');
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  if (mode === 'recipe') {
    return (
      <>
        <PickRecipe title="Что съели вне плана?" suggestions={[]} mealType="snack" onPick={onRecipe} />
        <button className="btn btn-ln btn-full" style={{ marginTop: 10 }} onClick={() => setMode('custom')}>Другое — записать своими словами</button>
      </>
    );
  }
  const k = kcal.trim() === '' ? null : Number(kcal.replace(',', '.'));
  return (
    <>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 22 }}>Своими словами</div>
      <label className="field"><span>Что съели</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="например, пирожок в столовой" /></label>
      <label className="field"><span>Калории, если знаете (можно пропустить)</span><input className="input" inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
      <p className="note small">Без калорий запись сохранится, а итог дня будет помечен как неполный.</p>
      <button className="btn btn-cu btn-full" disabled={!name.trim() || (k !== null && !(k >= 0))} onClick={() => onCustom(name.trim(), k)}>Записать</button>
    </>
  );
}

function CookPanel({ planned, batches, onCook }: { planned: string[]; batches: Batch[]; onCook: (id: string, p: number) => void }) {
  const ids = [...new Set(planned)];
  const [id, setId] = useState<string | null>(ids[0] ?? null);
  const [p, setP] = useState(() => (ids[0] ? Math.max(1, planned.filter((x) => x === ids[0]).length) : 2));
  return (
    <>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 22 }}>Приготовил заранее</div>
      <p className="note small">Продукты спишутся из запасов один раз. Потом при «Съел» порция возьмётся из приготовленного.</p>
      {batches.length > 0 && <p className="note small ok">Уже приготовлено: {batches.map((b) => `«${RECIPE_MAP.get(b.recipeId)?.name}»`).join(', ')}.</p>}
      <div className="h5">Блюда ближайших дней</div>
      {ids.map((rid) => {
        const r = RECIPE_MAP.get(rid)!;
        return (
          <button key={rid} className={`alt-opt ${id === rid ? 'sel' : ''}`} onClick={() => { setId(rid); setP(Math.max(1, planned.filter((x) => x === rid).length)); }}>
            <Obj name={r.icon ?? 'Pot of food'} size={52} /><span>{r.name}<small>{r.timeTotalMin} мин</small></span>
          </button>
        );
      })}
      <Stepper value={p} onChange={setP} />
      <button className="btn btn-cu btn-full" disabled={!id} onClick={() => id && onCook(id, p)}>Приготовил {fmtP(p)}</button>
    </>
  );
}

function EditEntry({ e, onPortions, onUnmark }: { e: Entry; onPortions: (p: number) => void; onUnmark: () => void }) {
  const r = e.recipeId ? RECIPE_MAP.get(e.recipeId) : null;
  return (
    <>
      <div className="h5" style={{ marginTop: 4 }}>{e.mealType ? MEAL_LABEL[e.mealType] : 'Вне плана'} · {e.status === 'skipped' ? 'пропуск' : e.status === 'replaced' ? 'заменил' : 'съел'}</div>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 22 }}>{r?.name ?? e.name ?? '—'}</div>
      {e.status !== 'skipped' && e.recipeId && <Stepper value={e.portions} onChange={onPortions} />}
      {e.stockWrittenOff && <p className="note small">Продукты для этого блюда списаны из запасов. При снятии отметки они вернутся.</p>}
      <button className="btn btn-ln btn-full" style={{ marginTop: 10 }} onClick={onUnmark}>Снять отметку</button>
    </>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  return (
    <div className="stepper">
      <span>Порции</span>
      <div>
        <button onClick={() => onChange(Math.max(0.5, value - (value > 1 ? 1 : 0.5)))}>−</button>
        <b>{String(value).replace('.', ',')}</b>
        <button onClick={() => onChange(Math.min(10, value < 1 ? 1 : value + 1))}>+</button>
      </div>
    </div>
  );
}

function leftoverOf(recipeId: string, batches: Batch[], entries: Entry[], day: string): number {
  const b = findBatch(recipeId, 0.5, batches, entries, day);
  return b ? batchLeftover(b, entries) : 0;
}

function toEntry(r: Row): Entry {
  return {
    id: String(r.id), day: String(r.day), mealType: (r.meal_type as MealType) ?? null, status: r.status as Entry['status'],
    recipeId: (r.recipe_id as string) ?? null, name: (r.name as string) ?? null, portions: Number(r.portions ?? 1),
    nutrition: (r.nutrition as NutrientTotals) ?? null, offPlan: !!r.off_plan, fromBatch: (r.from_batch as string) ?? null, stockWrittenOff: !!r.stock_written_off,
  };
}

/** Своя запись с известными калориями: остальные показатели неизвестны. */
function customNutrition(kcal: number): NutrientTotals {
  const u = { value: null, complete: false };
  return { kcal: { value: kcal, complete: true }, protein: u, fat: u, carbs: u, fiber: u };
}

function fmtP(p: number): string {
  const s = String(p).replace('.', ',');
  return `${s} ${p === 1 ? 'порция' : p < 5 && Number.isInteger(p) ? 'порции' : 'порций'}`;
}

function statusText(s?: string): string {
  return s === 'eaten' ? 'съел' : s === 'replaced' ? 'заменил' : s === 'skipped' ? 'пропустил' : 'не отмечено';
}

/** Сводка корзины по выбранной неделе — те же правила, что на экране «Корзина». */
function shoppingSummary(active: Day[] | null, stock: Map<string, number>, manualRows: Row[], priceRows: Row[]) {
  if (!active) return { hasPlan: false, toBuy: 0, knownSum: 0, unpriced: 0, examples: [] as string[] };
  const today = todayStr();
  const planned = active.filter((d) => d.date >= today).flatMap((d) => d.meals.filter((m) => m.recipeId).map((m) => ({ recipeId: m.recipeId!, portions: m.portions })));
  const prices = latestPrices(priceRows.map((r) => ({ ingredientId: String(r.ingredient_id), store: String(r.store), qty: Number(r.package_size), price: Number(r.price), date: String(r.price_date) })));
  const list = buildShoppingList({
    planned, recipes: RECIPE_MAP, ingredients: INGREDIENT_MAP, pantry: stock,
    packages: packagesFor(INGREDIENTS.map((i) => i.id), PACK_SIZE, prices),
    manual: manualRows.map((m) => ({ id: String(m.id), ingredientId: String(m.ingredient_id), amount: Number(m.amount), unit: m.unit as Unit })),
  });
  const lines = list.lines.filter((l) => l.toBuy > 0);
  return { hasPlan: true, toBuy: lines.length, knownSum: list.knownCost, unpriced: list.unpriced, examples: lines.slice(0, 6).map((l) => l.name) };
}
