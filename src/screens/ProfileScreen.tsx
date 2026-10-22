import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { INGREDIENTS, INGREDIENT_ICON, INGREDIENT_MAP, RECIPE_MAP } from '../catalog';
import { ACTIVITY, calcNorm, type Activity, type Sex } from '../core/norms';
import { checkBackup, exportBackup, restoreBackup, type Backup, type BackupCheck } from '../data/backup';
import { supabase, type SyncSession } from '../data/client';
import { uuid } from '../data/ids';
import type { Conflict } from '../data/localdb';
import type { SyncStatus } from '../data/sync';
import type { Row } from '../data/tables';
import { iconUrl, profileIcon } from '../ui/icons';
import { Obj, Sheet, useRows, useToast } from '../ui/kit';

const GOALS = [
  { v: 'lose', label: 'Снижать вес' },
  { v: 'keep', label: 'Поддерживать' },
  { v: 'gain', label: 'Набирать' },
  { v: 'none', label: 'Без цели по весу' },
] as const;

const EQUIPMENT = [
  { v: 'stove', label: 'Плита', icon: 'Fire' },
  { v: 'microwave', label: 'Микроволновка', icon: 'Bento box' },
  { v: 'oven', label: 'Духовка', icon: 'Bread' },
  { v: 'blender', label: 'Блендер', icon: 'Glass of milk' },
] as const;

type PrefKind = 'like' | 'dislike' | 'exclude';

export function ProfileScreen({ session, owner, email }: { session: SyncSession; owner: string; email: string }) {
  const { engine } = session;
  const [profiles] = useRows(session, 'profiles');
  const [prefs] = useRows(session, 'food_preferences');
  const [weights] = useRows(session, 'weight_entries');
  const [ratings] = useRows(session, 'taste_ratings');
  const [status, setStatus] = useState<SyncStatus>(engine.getStatus());
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [picker, setPicker] = useState<PrefKind | null>(null);
  const [kg, setKg] = useState('');
  const [toast, showToast] = useToast();

  useEffect(() => engine.subscribe((s) => { setStatus(s); void engine.conflicts().then(setConflicts); }), [engine]);

  const profile: Row = profiles[0] ?? { owner, goal: 'tasty_healthy', equipment: ['stove', 'microwave'], city: 'Красноярск', mode: 'smart_mix' };
  const sortedWeights = useMemo(() => [...weights].sort((a, b) => String(a.day).localeCompare(String(b.day))), [weights]);
  const lastWeight = sortedWeights[sortedWeights.length - 1];
  const norm = calcNorm({
    age: profile.age as number, sex: profile.sex as Sex, heightCm: profile.height_cm as number,
    weightKg: lastWeight ? Number(lastWeight.kg) : null, activity: profile.activity as Activity, medical: !!profile.medical_note,
  });

  async function save(patch: Row) {
    await engine.save('profiles', { ...profile, ...patch, owner });
    void engine.sync();
  }

  async function addPref(kind: PrefKind, ingredientId: string) {
    if (prefs.some((p) => p.ingredient_id === ingredientId && p.kind === kind)) return;
    await engine.save('food_preferences', { id: uuid(), kind, ingredient_id: ingredientId, label: INGREDIENT_MAP.get(ingredientId)!.name });
    void engine.sync();
  }

  async function removePref(p: Row) {
    await engine.remove('food_preferences', p);
    void engine.sync();
    showToast(`«${p.label}» убрано`, () => void engine.save('food_preferences', { ...p, deleted_at: null }).then(() => engine.sync()));
  }

  async function addWeight() {
    const v = Number(kg.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 20 || v >= 400) return showToast('Введите вес числом, например 82,4');
    await engine.save('weight_entries', { id: uuid(), day: today(), kg: v });
    setKg('');
    void engine.sync();
    showToast('Вес записан');
  }

  const hidden = ratings.filter((r) => r.never_suggest);
  const pill = statusPill(status);

  return (
    <div className="page">
      <header className="top">
        <div><div className="date">мои настройки</div><h1>Профиль</h1></div>
        <div className="kb">
          {norm.ok ? <><b>~{fmt(norm.kcal)}<small>ккал</small></b><div>норма · расчёт</div></> : <><b>—<small>ккал</small></b><div>норма не рассчитана</div></>}
        </div>
      </header>

      <section className="card row-card" style={{ marginTop: 18 }}>
        <Obj name={profileIcon(profile.sex)} size={70} />
        <div className="grow"><b className="serif">Цель</b><span className="note">Вкусно и полезно питаться</span></div>
      </section>

      <div className="label"><span>Вес</span></div>
      <section className="seg two-col">
        {GOALS.map((g) => (
          <button key={g.v} className={profile.weight_goal === g.v ? 'on' : ''} onClick={() => void save({ weight_goal: g.v })}>{g.label}</button>
        ))}
      </section>
      {profile.weight_goal === 'lose' || profile.weight_goal === 'gain' ? (
        <p className="note pad-x">Приложение не назначает дефицит или избыток калорий. Ориентир — норма ниже; темп изменения веса лучше обсудить с врачом.</p>
      ) : null}

      <PrefBlock title="Люблю" kind="like" prefs={prefs} onAdd={() => setPicker('like')} onRemove={removePref} />
      <PrefBlock title="Не люблю" kind="dislike" prefs={prefs} onAdd={() => setPicker('dislike')} onRemove={removePref} />
      <PrefBlock title="Исключить всегда" hint="аллергии и непереносимость" kind="exclude" prefs={prefs} onAdd={() => setPicker('exclude')} onRemove={removePref} />

      <div className="label"><span>Бюджет и время</span></div>
      <section className="card">
        <div className="rowp">
          <Obj name="Money bag" size={50} />
          <div className="grow"><small className="note">Бюджет на неделю, ₽</small>
            <input className="input slim" inputMode="numeric" defaultValue={profile.budget_week ? String(profile.budget_week) : ''} placeholder="например 3500"
              onBlur={(e) => { const v = Number(e.target.value.replace(/\s/g, '')); if (e.target.value === '' || (Number.isFinite(v) && v >= 0)) void save({ budget_week: e.target.value === '' ? null : v }); }} />
          </div>
        </div>
        <div className="rowp">
          <Obj name="Stopwatch" size={50} />
          <div className="grow"><small className="note">Готовить не дольше</small><b className="serif">{Number(profile.max_cook_min ?? 20)} минут</b>
            <input className="range" type="range" min={5} max={60} step={5} value={Number(profile.max_cook_min ?? 20)} onChange={(e) => void save({ max_cook_min: Number(e.target.value) })} />
          </div>
        </div>
      </section>

      <div className="label"><span>Техника на кухне</span></div>
      <section className="card tech">
        {EQUIPMENT.map((e) => {
          const list = (profile.equipment as string[]) ?? [];
          const on = list.includes(e.v);
          return (
            <button key={e.v} className={on ? 'on' : ''} onClick={() => void save({ equipment: on ? list.filter((x) => x !== e.v) : [...list, e.v] })}>
              <Obj name={e.icon} size={46} />{e.label}
            </button>
          );
        })}
      </section>

      <div className="label"><span>Для расчёта нормы</span><span>можно заполнить позже</span></div>
      <section className="card params">
        <label><span>Возраст</span><input className="input slim" inputMode="numeric" defaultValue={profile.age ? String(profile.age) : ''} onBlur={(e) => void save({ age: num(e.target.value, 1, 120) })} /></label>
        <label><span>Пол</span>
          <select className="input slim" value={(profile.sex as string) ?? ''} onChange={(e) => void save({ sex: e.target.value || null })}>
            <option value="">не указан</option><option value="male">мужской</option><option value="female">женский</option>
          </select>
        </label>
        <label><span>Рост, см</span><input className="input slim" inputMode="numeric" defaultValue={profile.height_cm ? String(profile.height_cm) : ''} onBlur={(e) => void save({ height_cm: num(e.target.value, 50, 260) })} /></label>
        <label><span>Вес</span><div className="static">{lastWeight ? `${fmtKg(lastWeight.kg)} кг` : 'запишите ниже'}</div></label>
        <label className="wide"><span>Физическая активность</span>
          <select className="input slim" value={(profile.activity as string) ?? ''} onChange={(e) => void save({ activity: e.target.value || null })}>
            <option value="">не указана</option>
            {(Object.keys(ACTIVITY) as Activity[]).map((a) => <option key={a} value={a}>{ACTIVITY[a].label}</option>)}
          </select>
        </label>
        <label className="wide check">
          <input type="checkbox" checked={!!profile.medical_note} onChange={(e) => void save({ medical_note: e.target.checked ? 'да' : null })} />
          <span>Беременность, кормление или лечебная диета</span>
        </label>
      </section>
      <section className="card pad norm">
        {norm.ok ? (
          <>
            <div>Норма <b className="serif big">~{fmt(norm.kcal)} ккал</b></div>
            <div className="note">Белки ~{norm.protein} г · жиры не более {norm.fatMax} г · углеводы ~{norm.carbs} г · клетчатка {norm.fiber[0]}–{norm.fiber[1]} г</div>
            <div className="note small">{norm.source}. Ориентир, а не медицинское назначение.</div>
          </>
        ) : (
          <><div>Норма <b className="serif big">не рассчитана</b></div><div className="note">{norm.reason}.</div></>
        )}
      </section>

      <div className="label"><span>Вес и прогресс</span></div>
      <section className="card pad">
        <WeightChart rows={sortedWeights} />
        <div className="inline">
          <input className="input" inputMode="decimal" placeholder="Вес сегодня, кг" value={kg} onChange={(e) => setKg(e.target.value)} />
          <button className="btn btn-cu" onClick={() => void addWeight()}>Записать</button>
        </div>
        {sortedWeights.length > 0 && (
          <div className="wlist">
            {[...sortedWeights].reverse().slice(0, 5).map((w) => (
              <div key={String(w.id)} className="wrow">
                <span>{new Date(String(w.day)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
                <b>{fmtKg(w.kg)} кг</b>
                <button className="x" aria-label="Удалить" onClick={() => { void engine.remove('weight_entries', w).then(() => engine.sync()); showToast('Запись удалена', () => void engine.save('weight_entries', { ...w, deleted_at: null }).then(() => engine.sync())); }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {hidden.length > 0 && (
        <>
          <div className="label"><span>Скрытые блюда</span><span>«Больше не предлагать»</span></div>
          <section className="card">
            {hidden.map((h) => (
              <div key={String(h.recipe_id)} className="rowp">
                <Obj name={RECIPE_MAP.get(String(h.recipe_id))?.icon ?? 'Pot of food'} size={44} />
                <div className="grow">{RECIPE_MAP.get(String(h.recipe_id))?.name ?? String(h.recipe_id)}</div>
                <button className="btn btn-ln small-btn" onClick={() => void engine.save('taste_ratings', { ...h, never_suggest: false }).then(() => engine.sync())}>Вернуть</button>
              </div>
            ))}
          </section>
        </>
      )}

      <div className="label"><span>Данные</span></div>
      {conflicts.map((c) => <ConflictCard key={c.id} c={c} onPick={(choice) => void engine.resolve(c.id, choice).then(() => engine.sync())} />)}
      <section className="card row-card">
        <Obj name="Cloud" size={54} />
        <div className="grow"><b className="serif">{pill.text}</b><span className="note">{status.lastSyncAt ? `iPhone и компьютер · ${new Date(status.lastSyncAt).toLocaleTimeString('ru-RU')}` : 'ещё не синхронизировалось'}</span>
          {status.failed > 0 && <span className="err">Сервер отклонил {status.failed} изменений: {status.lastError}</span>}
        </div>
      </section>
      <BackupBlock session={session} toast={showToast} />

      <section className="card row-card" style={{ marginTop: 10 }}>
        <div className="grow"><span className="note">Вы вошли как</span><div className="ellipsis">{email}</div></div>
        <button className="btn btn-ln small-btn" onClick={() => void supabase.auth.signOut()}>Выйти</button>
      </section>
      <p className="note small pad-x">Нормы: МР 2.3.1.0253-21 Роспотребнадзора. Состав продуктов: USDA FoodData Central. 3D-иконки: Microsoft Fluent Emoji (MIT).</p>

      <Sheet open={picker !== null} onClose={() => setPicker(null)}>
        {picker && <IngredientPicker title={picker === 'like' ? 'Люблю' : picker === 'dislike' ? 'Не люблю' : 'Исключить всегда'} onPick={(id) => { void addPref(picker, id); setPicker(null); }} />}
      </Sheet>
      {toast}
    </div>
  );
}

function PrefBlock({ title, hint, kind, prefs, onAdd, onRemove }: { title: string; hint?: string; kind: PrefKind; prefs: Row[]; onAdd: () => void; onRemove: (p: Row) => void }) {
  const list = prefs.filter((p) => p.kind === kind);
  return (
    <>
      <div className="label"><span>{title}</span>{hint && <span>{hint}</span>}</div>
      <section className="card tagbox">
        {list.map((p) => (
          <button key={String(p.id)} className={`tag ${kind === 'exclude' ? 'no' : ''}`} onClick={() => onRemove(p)} title="Убрать">
            <img src={iconUrl(kind === 'exclude' ? 'Prohibited' : INGREDIENT_ICON[String(p.ingredient_id)] ?? 'Herb')} alt="" />{String(p.label)} <span className="tag-x">✕</span>
          </button>
        ))}
        <button className="tag plus" onClick={onAdd}>+ добавить</button>
      </section>
    </>
  );
}

function IngredientPicker({ title, onPick }: { title: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = INGREDIENTS.filter((i) => !i.negligible && i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className="r-title" style={{ textAlign: 'left', fontSize: 24 }}>{title}</div>
      <input className="input" autoFocus placeholder="Найти продукт" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker">
        {list.map((i) => (
          <button key={i.id} onClick={() => onPick(i.id)}><img src={iconUrl(INGREDIENT_ICON[i.id])} alt="" />{i.name}</button>
        ))}
      </div>
    </>
  );
}

function WeightChart({ rows }: { rows: Row[] }) {
  if (rows.length < 2) return <p className="note">{rows.length === 0 ? 'Запишите вес — здесь появится график.' : 'После второй записи появится график.'}</p>;
  const pts = rows.slice(-30).map((r) => Number(r.kg));
  const min = Math.min(...pts) - 0.5, max = Math.max(...pts) + 0.5;
  const x = (i: number) => (i / (pts.length - 1)) * 300 + 10;
  const y = (v: number) => 100 - ((v - min) / (max - min)) * 80;
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const diff = pts[pts.length - 1] - pts[0];
  return (
    <div className="chart">
      <div className="chart-head"><b className="serif">{fmtKg(pts[pts.length - 1])} кг</b><span className={diff <= 0 ? 'ok' : 'up'}>{diff > 0 ? '+' : ''}{fmtKg(Math.round(diff * 10) / 10)} кг за период</span></div>
      <svg viewBox="0 0 320 110" preserveAspectRatio="none">
        <defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c17a3e" stopOpacity=".35" /><stop offset="1" stopColor="#c17a3e" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L${x(pts.length - 1)} 110 L10 110 Z`} fill="url(#gw)" />
        <path d={line} fill="none" stroke="#d8955a" strokeWidth="2.5" />
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="5" fill="#d8955a" />
      </svg>
    </div>
  );
}

function ConflictCard({ c, onPick }: { c: Conflict; onPick: (choice: 'local' | 'server') => void }) {
  const fields = Object.keys(c.local).filter((k) => !['owner', 'id', 'version', 'updated_at'].includes(k) && JSON.stringify(c.local[k]) !== JSON.stringify(c.server?.[k]));
  const show = (r: Row | null) => fields.map((f) => `${f}: ${String(r?.[f] ?? '—')}`).join(', ');
  return (
    <section className="card pad conflict">
      <b className="serif">Изменено на двух устройствах — выберите</b>
      <div className="row2">
        <button className="btn btn-cu" onClick={() => onPick('local')}>Это устройство<small>{show(c.local)}</small></button>
        <button className="btn btn-ln" onClick={() => onPick('server')}>Другое<small>{show(c.server)}</small></button>
      </div>
    </section>
  );
}

function BackupBlock({ session, toast }: { session: SyncSession; toast: (t: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [restore, setRestore] = useState<{ backup: Backup; check: BackupCheck } | null>(null);

  function download(b: Backup, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b)], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      setRestore({ backup: raw, check: checkBackup(raw) });
    } catch {
      setRestore({ backup: {} as Backup, check: { ok: false, errors: ['Файл повреждён или это не копия «Моя еда»'], counts: {} } });
    }
  }
  async function confirm() {
    if (!restore?.check.ok) return;
    download(await exportBackup(session.db), `моя-еда-перед-восстановлением-${stamp()}.json`);
    const owner = (await supabase.auth.getUser()).data.user!.id;
    await restoreBackup(session.db, restore.backup, owner);
    setRestore(null);
    await session.engine.refreshStatus();
    void session.engine.sync();
    toast('Данные восстановлены, прежнее состояние сохранено файлом');
  }
  return (
    <>
      <div className="row2" style={{ marginTop: 10 }}>
        <button className="btn btn-ln" onClick={() => void exportBackup(session.db).then((b) => { download(b, `моя-еда-копия-${stamp()}.json`); toast('Копия сохранена (без фото)'); })}>Резервная копия</button>
        <button className="btn btn-ln" onClick={() => fileRef.current?.click()}>Восстановить</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e)} />
      {restore && (
        <section className="card pad" style={{ marginTop: 10 }}>
          {restore.check.ok ? (
            <>
              <p className="note">Копия от {new Date(restore.check.createdAt!).toLocaleString('ru-RU')}. Записей: {Object.values(restore.check.counts).reduce((a, b) => a + (b ?? 0), 0)}.{restore.check.withPhotos ? '' : ' Без фото.'}</p>
              <p className="warn">Данные на устройстве будут заменены. Перед этим сохранится файл с текущим состоянием.</p>
              <div className="row2"><button className="btn btn-cu" onClick={() => void confirm()}>Восстановить</button><button className="btn btn-ln" onClick={() => setRestore(null)}>Отмена</button></div>
            </>
          ) : (
            <>
              <p className="err">Копию нельзя восстановить: {restore.check.errors.join('; ')}. Текущие данные не изменены.</p>
              <button className="btn btn-ln btn-full" onClick={() => setRestore(null)}>Понятно</button>
            </>
          )}
        </section>
      )}
    </>
  );
}

export function statusPill(s: SyncStatus): { text: string; cls: string } {
  if (s.conflicts > 0) return { text: 'Нужен ваш выбор', cls: 'wait' };
  if (!navigator.onLine || s.state === 'offline') return s.pending > 0 ? { text: `Сохранено на устройстве · ${s.pending} ждут отправки`, cls: 'wait' } : { text: 'Нет сети', cls: 'wait' };
  if (s.state === 'error') return { text: 'Ошибка синхронизации', cls: 'bad' };
  if (s.pending > 0) return { text: 'Отправка…', cls: 'wait' };
  return { text: 'Синхронизировано', cls: 'ok' };
}

const fmt = (n: number) => n.toLocaleString('ru-RU');
const fmtKg = (v: unknown) => String(v).replace('.', ',');
const today = () => new Date().toLocaleDateString('sv-SE');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
function num(v: string, min: number, max: number): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
