import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { supabase, type SyncSession } from '../data/client';
import { checkBackup, exportBackup, restoreBackup, type Backup, type BackupCheck } from '../data/backup';
import { uuid } from '../data/ids';
import type { Conflict } from '../data/localdb';
import type { SyncStatus } from '../data/sync';
import type { Row } from '../data/tables';

/**
 * Временный экран этапа 2: проверка входа, синхронизации, работы без сети,
 * конфликтов и резервной копии на реальных устройствах. Журнал веса — настоящая функция профиля.
 */
export function SyncCheckScreen({ session, email }: { session: SyncSession; email: string }) {
  const { engine, db } = session;
  const [status, setStatus] = useState<SyncStatus>(engine.getStatus());
  const [rows, setRows] = useState<Row[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [kg, setKg] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [restore, setRestore] = useState<{ backup: Backup; check: BackupCheck } | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const list = await engine.list('weight_entries');
    list.sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(b.created ?? '').localeCompare(String(a.created ?? '')));
    setRows(list);
    setConflicts(await engine.conflicts());
  }, [engine]);

  useEffect(() => {
    const off = engine.subscribe((s) => {
      setStatus(s);
      void reload();
    });
    const on = () => setOnline(true);
    const offl = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', offl);
    return () => {
      off();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', offl);
    };
  }, [engine, reload]);

  async function addWeight() {
    const value = Number(kg.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value >= 500) {
      setMsg('Введите вес числом, например 82,4');
      return;
    }
    setMsg('');
    await engine.save('weight_entries', { id: uuid(), day: new Date().toISOString().slice(0, 10), kg: value, note: deviceName() });
    setKg('');
    await reload();
    void engine.sync();
  }

  async function removeRow(r: Row) {
    await engine.remove('weight_entries', r);
    await reload();
    void engine.sync();
  }

  async function resolve(c: Conflict, choice: 'local' | 'server') {
    await engine.resolve(c.id, choice);
    await reload();
    void engine.sync();
  }

  async function download(backup: Backup, name: string) {
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function doExport() {
    await download(await exportBackup(db), `моя-еда-копия-${stamp()}.json`);
    setMsg('Копия сохранена (без фото — фото появятся на следующих этапах).');
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      setRestore({ backup: raw, check: checkBackup(raw) });
    } catch {
      setRestore({ backup: {} as Backup, check: { ok: false, errors: ['Файл повреждён или это не копия «Моя еда»'], counts: {} } });
    }
  }

  async function confirmRestore() {
    if (!restore?.check.ok) return;
    await download(await exportBackup(db), `моя-еда-перед-восстановлением-${stamp()}.json`);
    const owner = (await supabase.auth.getUser()).data.user!.id;
    await restoreBackup(db, restore.backup, owner);
    setRestore(null);
    await engine.refreshStatus();
    await reload();
    void engine.sync();
    setMsg('Данные восстановлены. Текущее состояние перед этим сохранено отдельным файлом.');
  }

  const pill = statusPill(status, online);

  return (
    <div className="page">
      <header className="top">
        <div>
          <div className="date">проверка этапа 2</div>
          <h1>Синхронизация</h1>
        </div>
        <span className={`pill ${pill.cls}`}>{pill.text}</span>
      </header>

      <div className="label"><span>Вы вошли как</span></div>
      <div className="card pad" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
        <button className="btn btn-ln" style={{ minHeight: 42 }} onClick={() => void supabase.auth.signOut()}>Выйти</button>
      </div>

      {conflicts.length > 0 && (
        <>
          <div className="label"><span>Изменено на двух устройствах — выберите</span></div>
          {conflicts.map((c) => (
            <div key={c.id} className="card pad" style={{ marginBottom: 8 }}>
              <p className="note" style={{ marginTop: 0 }}>Запись веса за {String(c.local.day)}</p>
              <div className="row2">
                <button className="btn btn-cu" onClick={() => void resolve(c, 'local')}>Это устройство: {String(c.local.kg)} кг</button>
                <button className="btn btn-ln" onClick={() => void resolve(c, 'server')}>Другое: {String(c.server?.kg ?? '—')} кг</button>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="label"><span>Журнал веса</span><span>{rows.length} записей</span></div>
      <div className="card pad">
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" inputMode="decimal" placeholder="Вес, кг" value={kg} onChange={(e) => setKg(e.target.value)} />
          <button className="btn btn-cu" onClick={() => void addWeight()}>Записать</button>
        </div>
        {msg && <p className="note" style={{ marginBottom: 0 }}>{msg}</p>}
      </div>
      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          {rows.map((r) => (
            <div key={String(r.id)} className="list-row">
              <div className="grow">
                <b>{String(r.kg).replace('.', ',')} кг</b>
                <div className="sub">
                  {String(r.day)} · {String(r.note ?? '')} · {typeof r.version === 'number' ? 'на сервере' : 'только на этом устройстве'}
                </div>
              </div>
              <button className="x" aria-label="Удалить" onClick={() => void removeRow(r)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="label"><span>Резервная копия</span></div>
      <div className="row2">
        <button className="btn btn-ln" onClick={() => void doExport()}>Сохранить копию</button>
        <button className="btn btn-ln" onClick={() => fileRef.current?.click()}>Восстановить</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void pickFile(e)} />
      {restore && (
        <div className="card pad" style={{ marginTop: 10 }}>
          {restore.check.ok ? (
            <>
              <p className="note" style={{ marginTop: 0 }}>
                Копия от {new Date(restore.check.createdAt!).toLocaleString('ru-RU')}:{' '}
                {Object.entries(restore.check.counts).filter(([, n]) => n).map(([t, n]) => `${tableName(t)} — ${n}`).join(', ') || 'пустая'}.
                {restore.check.withPhotos ? '' : ' Без фото.'}
              </p>
              <p className="warn">Текущие данные на устройстве будут заменены. Перед этим сохранится файл с текущим состоянием.</p>
              <div className="row2">
                <button className="btn btn-cu" onClick={() => void confirmRestore()}>Восстановить</button>
                <button className="btn btn-ln" onClick={() => setRestore(null)}>Отмена</button>
              </div>
            </>
          ) : (
            <>
              <p className="err" style={{ marginTop: 0 }}>Копию нельзя восстановить: {restore.check.errors.join('; ')}</p>
              <p className="note">Текущие данные не изменены.</p>
              <button className="btn btn-ln btn-full" onClick={() => setRestore(null)}>Понятно</button>
            </>
          )}
        </div>
      )}

      <p className="note" style={{ marginTop: 24, textAlign: 'center' }}>
        {status.lastSyncAt ? `Последняя синхронизация: ${new Date(status.lastSyncAt).toLocaleTimeString('ru-RU')}` : 'Синхронизация ещё не выполнялась'}
        {status.failed > 0 && <><br /><span className="err">Сервер отклонил {status.failed} изменений: {status.lastError}</span></>}
      </p>
    </div>
  );
}

function statusPill(s: SyncStatus, online: boolean): { text: string; cls: string } {
  if (s.conflicts > 0) return { text: 'Нужен ваш выбор', cls: 'wait' };
  if (!online || s.state === 'offline') {
    return s.pending > 0 ? { text: `Сохранено на устройстве · ${s.pending} ждут отправки`, cls: 'wait' } : { text: 'Нет сети', cls: 'wait' };
  }
  if (s.state === 'error') return { text: 'Ошибка синхронизации', cls: 'bad' };
  if (s.state === 'syncing' || s.pending > 0) return { text: 'Отправка…', cls: 'wait' };
  return { text: 'Синхронизировано', cls: 'ok' };
}

function deviceName(): string {
  return /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'компьютер';
}

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
}

function tableName(t: string): string {
  const names: Record<string, string> = { weight_entries: 'записей веса', taste_ratings: 'оценок', stock_movements: 'движений продуктов', food_entries: 'записей питания', profiles: 'профиль' };
  return names[t] ?? t;
}
