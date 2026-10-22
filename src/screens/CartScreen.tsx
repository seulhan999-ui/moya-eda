import { useMemo, useState } from 'react';
import { INGREDIENTS, INGREDIENT_ICON, INGREDIENT_MAP, PACK_SIZE, RECIPE_MAP, formatQty } from '../catalog';
import { mondayOf, type Day } from '../core/planner';
import { latestPrices, packagesFor, type PricePoint } from '../core/prices';
import { buildShoppingList, type ManualItem, type ShoppingLine } from '../core/shopping';
import { balances, correction, purchase, reverse } from '../core/stock';
import type { Department, Unit } from '../core/types';
import type { SyncSession } from '../data/client';
import { nowIso, uuid } from '../data/ids';
import type { Row } from '../data/tables';
import { iconUrl } from '../ui/icons';
import { Obj, Sheet, useRows, useToast } from '../ui/kit';
import { toMovement } from './RecipesScreen';

const DEPTS: [Department, string][] = [
  ['vegetables', 'Овощи и фрукты'], ['meat_fish', 'Мясо и рыба'], ['dairy', 'Молочное и яйца'], ['grains', 'Крупы и макароны'],
  ['bakery', 'Хлеб'], ['grocery', 'Бакалея и консервы'], ['frozen', 'Заморозка'], ['ready', 'Готовое'], ['other', 'Другое'],
];
const STORES = ['Командор', 'Пятёрочка', 'Магнит', 'Лента', 'О’КЕЙ', 'METRO', 'Другой'];
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const unitLabel = (u: Unit) => (u === 'g' ? 'г' : u === 'ml' ? 'мл' : 'шт');
const rub = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} ₽`;

export function CartScreen({ session, onMenu }: { session: SyncSession; onMenu: () => void }) {
  const { engine } = session;
  const [plans] = useRows(session, 'meal_plans');
  const [moves] = useRows(session, 'stock_movements');
  const [manualRows] = useRows(session, 'shopping_manual');
  const [priceRows] = useRows(session, 'store_prices');
  const [metaRows] = useRows(session, 'pantry_meta');
  const [tab, setTab] = useState<'buy' | 'home'>('buy');
  const [whole, setWhole] = useState(false);
  const [buy, setBuy] = useState<ShoppingLine | null>(null);
  const [adding, setAdding] = useState<'manual' | 'pantry' | null>(null);
  const [toast, showToast] = useToast();

  const today = todayStr();
  const week = mondayOf(today);
  const plan = plans.find((p) => p.week_start === week);
  const active = (plan?.variants as { active?: Day[] | null } | undefined)?.active ?? null;
  const movements = useMemo(() => moves.map(toMovement), [moves]);
  const stock = useMemo(() => balances(movements), [movements]);

  const prices = useMemo(() => latestPrices(priceRows.map((r): PricePoint => ({
    ingredientId: String(r.ingredient_id), store: String(r.store), qty: Number(r.package_size), price: Number(r.price), date: String(r.price_date),
  }))), [priceRows]);

  const list = useMemo(() => {
    if (!active) return null;
    const planned = active
      .filter((d) => whole || d.date >= today)
      .flatMap((d) => d.meals.filter((m) => m.recipeId).map((m) => ({ recipeId: m.recipeId!, portions: m.portions })));
    const manual: ManualItem[] = manualRows.map((m) => ({ id: String(m.id), ingredientId: String(m.ingredient_id), amount: Number(m.amount), unit: m.unit as Unit }));
    const ids = INGREDIENTS.map((i) => i.id);
    return buildShoppingList({
      planned, recipes: RECIPE_MAP, ingredients: INGREDIENT_MAP, pantry: stock,
      packages: packagesFor(ids, PACK_SIZE, prices), manual,
    });
  }, [active, whole, today, manualRows, stock, prices]);

  const boughtThisWeek = movements
    .filter((m) => m.kind === 'purchase' && m.at.slice(0, 10) >= week)
    .filter((m) => !movements.some((x) => x.kind === 'reversal' && x.refId === m.opId))
    .sort((a, b) => b.at.localeCompare(a.at));

  async function confirmBuy(line: ShoppingLine, qty: number, price: number | null, store: string) {
    const opId = uuid();
    const mv = purchase(opId, line.ingredientId, qty, nowIso(), price != null ? { price, store } : { store });
    await engine.append('stock_movements', { op_id: mv.opId, ingredient_id: mv.ingredientId, delta: mv.delta, kind: mv.kind, at: mv.at, price: price ?? null, store });
    let priceId: string | null = null;
    if (price != null) {
      priceId = uuid();
      await engine.save('store_prices', { id: priceId, ingredient_id: line.ingredientId, store, city: 'Красноярск', package_size: qty, price, price_date: todayStr(), source: 'receipt' });
    }
    const usedManual = manualRows.filter((m) => m.ingredient_id === line.ingredientId);
    for (const m of usedManual) await engine.remove('shopping_manual', m);
    try { localStorage.setItem('lastStore', store); } catch { /* приватный режим */ }
    void engine.sync();
    setBuy(null);
    showToast(`${INGREDIENT_MAP.get(line.ingredientId)!.name}: +${formatQty(qty, line.unit)} в запасы`, () => void undoBuy(opId, priceId, usedManual));
  }

  async function undoBuy(opId: string, priceId: string | null, manual: Row[] = []) {
    for (const r of reverse(opId, movements.concat(), nowIso())) {
      await engine.append('stock_movements', { op_id: r.opId, ingredient_id: r.ingredientId, delta: r.delta, kind: r.kind, ref_id: r.refId, at: r.at });
    }
    const pr = priceRows.find((r) => r.id === priceId);
    if (pr) await engine.remove('store_prices', pr);
    for (const m of manual) await engine.save('shopping_manual', { ...m, deleted_at: null });
    void engine.sync();
  }

  async function setQty(id: string, actual: number) {
    const cur = stock.get(id) ?? 0;
    if (Math.abs(actual - cur) < 1e-9) return;
    const c = correction(uuid(), id, cur, Math.max(0, actual), nowIso());
    await engine.append('stock_movements', { op_id: c.opId, ingredient_id: c.ingredientId, delta: c.delta, kind: c.kind, at: c.at });
    void engine.sync();
  }

  async function setExpiry(id: string, date: string) {
    const cur = metaRows.find((m) => m.ingredient_id === id);
    await engine.save('pantry_meta', { ...(cur ?? { ingredient_id: id }), expires_on: date || null });
    void engine.sync();
  }

  const toBuy = list?.lines.filter((l) => l.toBuy > 0) ?? [];
  const homeIds = [...new Set([...[...stock.entries()].filter(([, v]) => Math.abs(v) > 1e-9).map(([k]) => k)])];
  const meta = new Map(metaRows.map((m) => [String(m.ingredient_id), m]));
  const daysLeft = (id: string) => {
    const d = meta.get(id)?.expires_on as string | undefined;
    return d ? Math.round((Date.parse(d + 'T12:00:00') - Date.parse(today + 'T12:00:00')) / 86400000) : null;
  };
  homeIds.sort((a, b) => (daysLeft(a) ?? 999) - (daysLeft(b) ?? 999) || INGREDIENT_MAP.get(a)!.name.localeCompare(INGREDIENT_MAP.get(b)!.name));

  return (
    <div className="page">
      <header className="top">
        <div><div className="date">{whole ? 'на всю неделю' : 'с сегодняшнего дня'}</div><h1>Корзина</h1></div>
        <div className="kb"><b>{toBuy.length}<small>к покупке</small></b><div>Красноярск</div></div>
      </header>

      <section className="seg two-col" style={{ marginTop: 18 }}>
        <button className={tab === 'buy' ? 'on' : ''} onClick={() => setTab('buy')}>Купить</button>
        <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>Есть дома</button>
      </section>

      {tab === 'buy' && (
        !active ? (
          <section className="card pad soon">
            <Obj name="Basket" size={120} float />
            <b className="serif">Сначала выберите неделю</b>
            <p className="note">Корзина собирается из «Моей недели» в разделе «Меню».</p>
            <button className="btn btn-cu btn-full" onClick={onMenu}>Открыть меню</button>
          </section>
        ) : (
          <>
            <div className="toggle-row">
              <button className={`pill-btn ${!whole ? 'on' : ''}`} onClick={() => setWhole(false)}>С сегодняшнего дня</button>
              <button className={`pill-btn ${whole ? 'on' : ''}`} onClick={() => setWhole(true)}>Вся неделя</button>
            </div>
            <section className="card sum3">
              <div><b>{toBuy.length}</b>купить</div>
              <div><b>{list && list.knownCost > 0 ? rub(list.knownCost) : '—'}</b>{list?.costComplete ? 'итого' : 'известная сумма'}</div>
              <div className={list && list.unpriced ? 'warn' : ''}><b>{list?.unpriced ?? 0}</b>без цены</div>
            </section>
            {list && !list.costComplete && toBuy.length > 0 && <p className="note small pad-x">Сумма неполная: у части продуктов ещё нет цены. Цена появится после первой покупки с чеком. Доставка не учтена.</p>}

            {toBuy.length === 0 && <section className="card pad empty"><Obj name="Check mark button" size={80} /><p className="note">Всё для меню уже есть дома.</p></section>}
            {DEPTS.map(([dep, label]) => {
              const lines = toBuy.filter((l) => l.department === dep);
              if (!lines.length) return null;
              return (
                <div key={dep}>
                  <div className="label"><span>{label}</span></div>
                  <section className="card">
                    {lines.map((l) => <CartLine key={l.ingredientId} l={l} onBuy={() => setBuy(l)} />)}
                  </section>
                </div>
              );
            })}

            <button className="add-snack" onClick={() => setAdding('manual')}>+ Добавить продукт вручную</button>
            {manualRows.length > 0 && (
              <p className="note small pad-x">Добавлено вручную: {manualRows.map((m) => `${INGREDIENT_MAP.get(String(m.ingredient_id))?.name} ${formatQty(Number(m.amount), m.unit as Unit)}`).join(', ')}. Сохранится при изменении меню.</p>
            )}

            {boughtThisWeek.length > 0 && (
              <>
                <div className="label"><span>Куплено на этой неделе</span></div>
                <section className="card">
                  {boughtThisWeek.map((m) => {
                    const ing = INGREDIENT_MAP.get(m.ingredientId)!;
                    const row = moves.find((r) => r.op_id === m.opId);
                    return (
                      <div key={m.opId} className="item bought">
                        <img src={iconUrl(INGREDIENT_ICON[ing.id])} alt="" className="item-ic" />
                        <div className="grow"><b>{ing.name}</b><span className="calc">{formatQty(m.delta, ing.unit)}{row?.price != null ? ` · ${rub(Number(row.price))}` : ''}{row?.store ? ` · ${row.store}` : ''}</span></div>
                        <button className="link" onClick={() => void undoBuy(m.opId, priceRows.find((p) => p.ingredient_id === ing.id && Number(p.price) === Number(row?.price))?.id as string ?? null)}>Отменить</button>
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </>
        )
      )}

      {tab === 'home' && (
        <>
          <div className="label"><span>{homeIds.length ? 'Сначала то, что скоро испортится' : 'Запасов пока нет'}</span></div>
          {homeIds.length > 0 && (
            <section className="card">
              {homeIds.map((id) => {
                const ing = INGREDIENT_MAP.get(id)!;
                const q = stock.get(id) ?? 0;
                const left = daysLeft(id);
                const step = ing.unit === 'pcs' ? 1 : ing.unit === 'ml' ? 100 : 50;
                return (
                  <div key={id} className="item">
                    <img src={iconUrl(INGREDIENT_ICON[id])} alt="" className="item-ic" />
                    <div className="grow">
                      <b>{ing.name}</b>
                      {q < 0 ? <span className="err">Запас ушёл в минус — уточните количество</span> : (
                        <label className="exp">
                          {left === null ? 'срок не указан' : left < 0 ? 'срок вышел' : left === 0 ? 'годен сегодня' : `годен ещё ${left} дн.`}
                          <input type="date" value={(meta.get(id)?.expires_on as string) ?? ''} onChange={(e) => void setExpiry(id, e.target.value)} />
                        </label>
                      )}
                    </div>
                    <div className="qty">
                      <button onClick={() => void setQty(id, Math.max(0, q - step))} aria-label="Меньше">−</button>
                      <b>{formatQty(Math.max(0, q), ing.unit)}</b>
                      <button onClick={() => void setQty(id, Math.max(0, q) + step)} aria-label="Больше">+</button>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          <button className="add-snack" onClick={() => setAdding('pantry')}>+ Добавить продукт, который есть дома</button>
          <p className="note small pad-x">Можно отмечать не все запасы — только то, что важно для меню.</p>
        </>
      )}

      <Sheet open={buy !== null} onClose={() => setBuy(null)}>
        {buy && <BuyPanel line={buy} onConfirm={(q, p, s) => void confirmBuy(buy, q, p, s)} />}
      </Sheet>
      <Sheet open={adding !== null} onClose={() => setAdding(null)}>
        {adding && (
          <AddPanel
            title={adding === 'manual' ? 'Добавить в покупки' : 'Есть дома'}
            onAdd={async (id, amount) => {
              const ing = INGREDIENT_MAP.get(id)!;
              if (adding === 'manual') {
                await engine.save('shopping_manual', { id: uuid(), ingredient_id: id, amount, unit: ing.unit });
              } else {
                await setQty(id, (stock.get(id) ?? 0) + amount);
              }
              void engine.sync();
              setAdding(null);
              showToast(`${ing.name}: добавлено`);
            }}
          />
        )}
      </Sheet>
      {toast}
    </div>
  );
}

function CartLine({ l, onBuy }: { l: ShoppingLine; onBuy: () => void }) {
  const loose = PACK_SIZE[l.ingredientId] == null;
  return (
    <div className="item">
      <img src={iconUrl(INGREDIENT_ICON[l.ingredientId])} alt="" className="item-ic" />
      <div className="grow">
        <b>{l.name}</b>
        <span className="calc">
          {l.need > 0 && <>нужно {formatQty(l.need, l.unit)} · дома {formatQty(l.available, l.unit)} → </>}купить <strong>{formatQty(l.toBuy, l.unit)}</strong>
          {l.manual > 0 && l.need > 0 && ` (из них вручную ${formatQty(l.manual, l.unit)})`}
        </span>
        {!loose && l.packs !== null && l.packSize && (
          <span className="pack">{l.packs} уп. по {formatQty(l.packSize, l.unit)}{l.plannedLeftover && l.plannedLeftover > 0 ? ` · останется ${formatQty(l.plannedLeftover, l.unit)}` : ''}</span>
        )}
        {loose && <span className="pack">на развес / поштучно</span>}
        {l.cost !== null ? <span className="price">~{rub(l.cost)} · {l.priceSource ?? 'мой чек'}</span> : <span className="price unk">цена неизвестна</span>}
      </div>
      <button className="chk" aria-label="Куплено" onClick={onBuy}>✓</button>
    </div>
  );
}

function BuyPanel({ line, onConfirm }: { line: ShoppingLine; onConfirm: (qty: number, price: number | null, store: string) => void }) {
  const loose = PACK_SIZE[line.ingredientId] == null;
  const suggested = !loose && line.packs && line.packSize ? line.packs * line.packSize : Math.ceil(line.toBuy);
  const [qty, setQty] = useState(String(suggested));
  const [price, setPrice] = useState('');
  let last = 'Командор';
  try { last = localStorage.getItem('lastStore') ?? last; } catch { /* приватный режим */ }
  const [store, setStore] = useState(last);
  const q = Number(qty.replace(',', '.'));
  const p = price.trim() === '' ? null : Number(price.replace(',', '.').replace(/\s/g, ''));
  const valid = Number.isFinite(q) && q > 0 && (p === null || (Number.isFinite(p) && p >= 0));
  return (
    <>
      <div className="h5" style={{ marginTop: 4 }}>Куплено</div>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 24 }}>{line.name}</div>
      <label className="field"><span>Сколько купили, {unitLabel(line.unit)}</span><input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      <label className="field"><span>Сколько заплатили, ₽ (из чека, можно пропустить)</span><input className="input" inputMode="decimal" placeholder="например 89" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <div className="field"><span>Магазин</span>
        <div className="chips wrap">{STORES.map((s) => <button key={s} className={`pill-btn ${store === s ? 'on' : ''}`} onClick={() => setStore(s)}>{s}</button>)}</div>
      </div>
      <p className="note small">{formatQty(Number.isFinite(q) ? q : 0, line.unit)} добавятся в «Есть дома».{p !== null ? ' Цена запомнится с магазином и датой.' : ' Без цены стоимость в следующий раз останется неизвестной.'}</p>
      <button className="btn btn-cu btn-full" disabled={!valid} onClick={() => onConfirm(q, p, store)}>Подтвердить покупку</button>
    </>
  );
}

function AddPanel({ title, onAdd }: { title: string; onAdd: (id: string, amount: number) => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const list = INGREDIENTS.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
  if (picked) {
    const ing = INGREDIENT_MAP.get(picked)!;
    const a = Number(amount.replace(',', '.'));
    return (
      <>
        <div className="r-title" style={{ textAlign: 'left', fontSize: 24 }}>{ing.name}</div>
        <label className="field"><span>Количество, {unitLabel(ing.unit)}</span><input className="input" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={ing.unit === 'pcs' ? 'например 10' : 'например 500'} /></label>
        <button className="btn btn-cu btn-full" disabled={!(a > 0)} onClick={() => onAdd(picked, a)}>Добавить</button>
        <button className="link" style={{ marginTop: 10 }} onClick={() => setPicked(null)}>‹ Другой продукт</button>
      </>
    );
  }
  return (
    <>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 24 }}>{title}</div>
      <input className="input" placeholder="Найти продукт" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker">
        {list.map((i) => <button key={i.id} onClick={() => setPicked(i.id)}><img src={iconUrl(INGREDIENT_ICON[i.id])} alt="" />{i.name}</button>)}
      </div>
    </>
  );
}

