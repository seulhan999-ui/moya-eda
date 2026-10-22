import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { SyncSession } from '../data/client';
import type { Row, TableName } from '../data/tables';
import { iconUrl } from './icons';

/** Объёмная 3D-иконка с медной подсветкой и тенью-подставкой. */
export function Obj({ name, size = 56, float = false, dim = false, className = '' }: { name: string; size?: number; float?: boolean; dim?: boolean; className?: string }) {
  return (
    <div className={`obj ${float ? 'float' : ''} ${dim ? 'dim' : ''} ${className}`} style={{ width: size, height: size }}>
      <img src={iconUrl(name)} alt="" loading="lazy" />
    </div>
  );
}

/** Строки таблицы из локального хранилища; обновляются после любых изменений и синхронизации. */
export function useRows(session: SyncSession, table: TableName): [Row[], () => Promise<void>] {
  const [rows, setRows] = useState<Row[]>([]);
  const reload = useCallback(async () => setRows(await session.engine.list(table)), [session, table]);
  useEffect(() => {
    void reload();
    return session.engine.subscribe(() => void reload());
  }, [session, reload]);
  return [rows, reload];
}

/** Нижняя выдвижная панель. */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  return (
    <>
      <div className={`sheet-bg ${open ? 'open' : ''}`} onClick={onClose} />
      <section className={`sheet ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="grab" />
        <button className="sheet-x" onClick={onClose} aria-label="Закрыть">✕</button>
        {open && children}
      </section>
    </>
  );
}

/** Короткое сообщение внизу экрана, при необходимости с кнопкой «Отменить». */
export function useToast(): [ReactNode, (text: string, undo?: () => void) => void] {
  const [msg, setMsg] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = (
    <div className={`toast ${msg ? 'show' : ''}`} role="status">
      <span>{msg?.text}</span>
      {msg?.undo && (
        <button onClick={() => { msg.undo!(); setMsg(null); }}>Отменить</button>
      )}
    </div>
  );
  return [node, (text, undo) => setMsg({ text, undo, id: Date.now() })];
}
