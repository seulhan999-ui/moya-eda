// Локальное хранилище на устройстве (IndexedDB).
// Здесь лежит копия данных, очередь неотправленных изменений и конфликты.
// Ошибка синхронизации никогда не удаляет эти данные.

import type { Row, TableName } from './tables';

export interface LocalRow {
  t: TableName;
  k: string;
  row: Row;
}

export type OpKind = 'insert' | 'update' | 'restore';

export interface OutboxOp {
  seq?: number;
  opId: string;
  table: TableName;
  key: string;
  kind: OpKind;
  /** Полные данные строки (без серверных полей). */
  data: Row;
  /** Версия строки на сервере, от которой сделана правка (для update). */
  baseVersion?: number;
  attempts: number;
  lastError?: string;
  /** Ошибка данных: операция не повторяется автоматически, но и не удаляется. */
  failed?: boolean;
  createdAt: string;
}

export interface Conflict {
  id: string;
  table: TableName;
  key: string;
  local: Row;
  server: Row | null;
  createdAt: string;
}

const DB_NAME = 'moya-eda';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class LocalDb {
  private db: IDBDatabase;
  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(name = DB_NAME): Promise<LocalDb> {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      const rows = db.createObjectStore('rows', { keyPath: ['t', 'k'] });
      rows.createIndex('t', 't');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }).createIndex('key', ['table', 'key']);
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('conflicts', { keyPath: 'id' });
    };
    return new LocalDb(await req(open));
  }

  close(): void {
    this.db.close();
  }

  // ---------- строки ----------
  async get(t: TableName, k: string): Promise<Row | undefined> {
    const r = await req(this.db.transaction('rows').objectStore('rows').get([t, k]));
    return (r as LocalRow | undefined)?.row;
  }

  async all(t: TableName): Promise<Row[]> {
    const list = await req(this.db.transaction('rows').objectStore('rows').index('t').getAll(t));
    return (list as LocalRow[]).map((x) => x.row);
  }

  async putRow(t: TableName, k: string, row: Row): Promise<void> {
    const tx = this.db.transaction('rows', 'readwrite');
    tx.objectStore('rows').put({ t, k, row });
    await done(tx);
  }

  /** Записать строку и операцию в очередь одной транзакцией: данные не потеряются при сбое. */
  async putWithOp(t: TableName, k: string, row: Row, op: OutboxOp): Promise<void> {
    const tx = this.db.transaction(['rows', 'outbox'], 'readwrite');
    tx.objectStore('rows').put({ t, k, row });
    const outbox = tx.objectStore('outbox');
    // Несколько правок одной строки до отправки объединяются: сохраняется исходная версия.
    if (op.kind === 'update') {
      const existing = (await req(outbox.index('key').getAll([t, k]))) as OutboxOp[];
      const pending = existing.find((o) => !o.failed && (o.kind === 'update' || o.kind === 'insert'));
      if (pending) {
        outbox.put({ ...pending, data: op.data });
        await done(tx);
        return;
      }
    }
    outbox.add(op);
    await done(tx);
  }

  async deleteRow(t: TableName, k: string): Promise<void> {
    const tx = this.db.transaction('rows', 'readwrite');
    tx.objectStore('rows').delete([t, k]);
    await done(tx);
  }

  async clearRows(): Promise<void> {
    const tx = this.db.transaction(['rows', 'outbox', 'conflicts', 'meta'], 'readwrite');
    for (const s of ['rows', 'outbox', 'conflicts', 'meta']) tx.objectStore(s).clear();
    await done(tx);
  }

  // ---------- очередь ----------
  async outbox(): Promise<OutboxOp[]> {
    return (await req(this.db.transaction('outbox').objectStore('outbox').getAll())) as OutboxOp[];
  }

  async updateOp(op: OutboxOp): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').put(op);
    await done(tx);
  }

  async removeOp(seq: number): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(seq);
    await done(tx);
  }

  async hasPending(t: TableName, k: string): Promise<boolean> {
    const list = (await req(this.db.transaction('outbox').objectStore('outbox').index('key').getAll([t, k]))) as OutboxOp[];
    return list.length > 0;
  }

  // ---------- служебное ----------
  async getMeta<T>(key: string): Promise<T | undefined> {
    const r = (await req(this.db.transaction('meta').objectStore('meta').get(key))) as { value: T } | undefined;
    return r?.value;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    await done(tx);
  }

  // ---------- конфликты ----------
  async conflicts(): Promise<Conflict[]> {
    return (await req(this.db.transaction('conflicts').objectStore('conflicts').getAll())) as Conflict[];
  }

  async addConflict(c: Conflict): Promise<void> {
    const tx = this.db.transaction('conflicts', 'readwrite');
    tx.objectStore('conflicts').put(c);
    await done(tx);
  }

  async removeConflict(id: string): Promise<void> {
    const tx = this.db.transaction('conflicts', 'readwrite');
    tx.objectStore('conflicts').delete(id);
    await done(tx);
  }
}
