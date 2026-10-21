// Движок синхронизации «сначала на устройстве».
// 1. Любое изменение сразу записывается локально и ставится в очередь.
// 2. Очередь отправляется на сервер, когда есть сеть; повтор операции не создаёт копий.
// 3. С сервера забираются изменения, сделанные на другом устройстве.
// 4. Если одно и то же значение изменили на двух устройствах — сохраняются оба варианта,
//    пользователь выбирает. Ничего не теряется молча.

import { uuid, nowIso } from './ids';
import type { Conflict, LocalDb, OutboxOp } from './localdb';
import { DataError, NetworkError, type Remote } from './remote';
import { TABLES, TABLE_NAMES, payload, pkKey, pkOf, type Row, type TableName } from './tables';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Изменения, сохранённые на устройстве и ещё не отправленные. */
  pending: number;
  /** Операции, которые сервер отклонил как неверные данные. */
  failed: number;
  conflicts: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

/** Окно перекрытия при получении изменений: защищает от «опоздавших» записей. */
const PULL_OVERLAP_MS = 2 * 60 * 1000;
const PAGE = 500;

export class SyncEngine {
  private running: Promise<void> | null = null;
  private again = false;
  private listeners = new Set<(s: SyncStatus) => void>();
  private status: SyncStatus = { state: 'idle', pending: 0, failed: 0, conflicts: 0, lastSyncAt: null, lastError: null };

  private db: LocalDb;
  private remote: Remote;
  private owner: string;

  constructor(db: LocalDb, remote: Remote, owner: string) {
    this.db = db;
    this.remote = remote;
    this.owner = owner;
  }

  // ---------------- изменения на устройстве ----------------

  /** Создать или изменить строку. */
  async save(table: TableName, row: Row): Promise<Row> {
    if (TABLES[table].mode === 'append') throw new Error(`${table}: журнал только пополняется — используйте append`);
    const data = payload({ ...row, owner: this.owner });
    const key = pkKey(table, data);
    const existing = await this.db.get(table, key);
    const local = { ...(existing ?? {}), ...data };
    const synced = typeof existing?.version === 'number';
    const pending = await this.db.hasPending(table, key);
    const op: OutboxOp = {
      opId: uuid(),
      table,
      key,
      kind: synced || pending ? 'update' : 'insert',
      data: payload(local),
      baseVersion: synced ? (existing!.version as number) : undefined,
      attempts: 0,
      createdAt: nowIso(),
    };
    await this.db.putWithOp(table, key, local, op);
    await this.refreshStatus();
    return local;
  }

  /** Добавить запись в журнал (движение продуктов). Повтор с тем же op_id игнорируется. */
  async append(table: TableName, row: Row): Promise<Row> {
    if (row.op_id != null) {
      const same = (await this.db.all(table)).find((r) => r.op_id === row.op_id);
      if (same) return same; // та же операция уже записана — повтор ничего не меняет
    }
    const data = payload({ id: uuid(), ...row, owner: this.owner });
    const key = pkKey(table, data);
    await this.db.putWithOp(table, key, data, { opId: uuid(), table, key, kind: 'insert', data, attempts: 0, createdAt: nowIso() });
    await this.refreshStatus();
    return data;
  }

  /** Удаление — отметкой времени, чтобы удаление дошло до второго устройства. */
  async remove(table: TableName, row: Row): Promise<void> {
    await this.save(table, { ...row, deleted_at: nowIso() });
  }

  async list(table: TableName, includeDeleted = false): Promise<Row[]> {
    const rows = await this.db.all(table);
    return includeDeleted ? rows : rows.filter((r) => !r.deleted_at);
  }

  // ---------------- синхронизация ----------------

  sync(): Promise<void> {
    if (this.running) {
      // Изменение пришло во время синхронизации — пройдём ещё раз после текущей.
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runSync();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSync(): Promise<void> {
    this.setStatus({ state: 'syncing' });
    try {
      await this.push();
      await this.pull();
      await this.push();
      this.setStatus({ state: 'idle', lastSyncAt: nowIso(), lastError: null });
    } catch (e) {
      const offline = e instanceof NetworkError;
      this.setStatus({ state: offline ? 'offline' : 'error', lastError: String((e as Error).message ?? e) });
    }
    await this.refreshStatus();
  }

  /** Отправить очередь по порядку. При ошибке сети — остановиться, всё остаётся в очереди. */
  async push(): Promise<void> {
    for (const op of await this.db.outbox()) {
      if (op.failed) continue;
      try {
        await this.pushOne(op);
        await this.db.removeOp(op.seq!);
      } catch (e) {
        op.attempts += 1;
        op.lastError = String((e as Error).message ?? e);
        if (e instanceof DataError) {
          op.failed = true;
          await this.db.updateOp(op);
          continue;
        }
        await this.db.updateOp(op);
        throw e;
      }
    }
  }

  private async pushOne(op: OutboxOp): Promise<void> {
    const { table, key, data } = op;
    if (op.kind === 'insert') {
      await this.acceptServerRow(table, key, await this.remote.insert(table, data), op.seq);
      return;
    }
    if (op.kind === 'restore') {
      await this.acceptServerRow(table, key, await this.remote.upsert(table, data), op.seq);
      return;
    }
    const pk = pkOf(table, data);
    const updated = await this.remote.updateIfVersion(table, pk, data, op.baseVersion ?? 0);
    if (updated) {
      await this.acceptServerRow(table, key, updated, op.seq);
      return;
    }
    const server = await this.remote.get(table, pk);
    if (!server) {
      // Строки на сервере нет (первая отправка не дошла) — создаём.
      await this.acceptServerRow(table, key, await this.remote.insert(table, data), op.seq);
      return;
    }
    if (sameData(data, server)) {
      await this.acceptServerRow(table, key, server, op.seq);
      return;
    }
    // Конфликт: на сервере другая версия. Сохраняем обе, решает пользователь.
    const conflict: Conflict = { id: uuid(), table, key, local: data, server, createdAt: nowIso() };
    await this.db.addConflict(conflict);
  }

  /** Записать строку с сервера, если на устройстве нет более новой неотправленной правки. */
  private async acceptServerRow(table: TableName, key: string, row: Row, exceptSeq?: number): Promise<void> {
    const serverKey = pkKey(table, row);
    if (serverKey !== key) {
      // Сервер вернул уже существующую запись той же операции — локальную копию убираем.
      await this.db.deleteRow(table, key);
      key = serverKey;
    }
    const pendingOther = (await this.db.outbox()).some((o) => o.table === table && o.key === key && o.seq !== exceptSeq);
    if (pendingOther) {
      // Есть следующая правка той же строки — она должна идти от новой версии сервера.
      for (const o of await this.db.outbox()) {
        if (o.table === table && o.key === key && o.seq !== exceptSeq && o.kind === 'update') {
          o.baseVersion = row.version as number;
          await this.db.updateOp(o);
        }
      }
      const local = await this.db.get(table, key);
      await this.db.putRow(table, key, { ...local, version: row.version, updated_at: row.updated_at });
      return;
    }
    await this.db.putRow(table, key, row);
  }

  /** Забрать изменения с сервера по каждой таблице. */
  async pull(): Promise<void> {
    const cursors = (await this.db.getMeta<Record<string, string>>('cursors')) ?? {};
    for (const table of TABLE_NAMES) {
      const col = TABLES[table].cursor;
      let since = cursors[table] ? new Date(Date.parse(cursors[table]) - PULL_OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
      let max = cursors[table] ?? null;
      for (;;) {
        const rows = await this.remote.pullSince(table, since, PAGE);
        for (const row of rows) {
          const key = pkKey(table, row);
          if (await this.db.hasPending(table, key)) continue;
          const local = await this.db.get(table, key);
          if (!local || typeof local.version !== 'number' || (row.version as number ?? 0) >= local.version) {
            await this.db.putRow(table, key, row);
          }
          const at = row[col] as string;
          if (!max || at > max) max = at;
        }
        if (rows.length < PAGE) break;
        const last = rows[rows.length - 1][col] as string;
        if (last === since) break;
        since = last;
      }
      if (max) cursors[table] = max;
    }
    await this.db.setMeta('cursors', cursors);
  }

  // ---------------- конфликты ----------------

  conflicts(): Promise<Conflict[]> {
    return this.db.conflicts();
  }

  /** Выбор пользователя: оставить вариант с этого устройства или с сервера. */
  async resolve(conflictId: string, choice: 'local' | 'server'): Promise<void> {
    const c = (await this.db.conflicts()).find((x) => x.id === conflictId);
    if (!c) return;
    if (choice === 'server' && c.server) {
      await this.db.putRow(c.table, c.key, c.server);
    } else {
      const local = { ...c.local };
      await this.db.putWithOp(c.table, c.key, { ...local, version: c.server?.version }, {
        opId: uuid(), table: c.table, key: c.key, kind: 'update', data: payload(local),
        baseVersion: (c.server?.version as number) ?? 0, attempts: 0, createdAt: nowIso(),
      });
    }
    await this.db.removeConflict(c.id);
    await this.refreshStatus();
  }

  // ---------------- состояние ----------------

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  async refreshStatus(): Promise<void> {
    const ops = await this.db.outbox();
    const conflicts = await this.db.conflicts();
    this.setStatus({
      pending: ops.filter((o) => !o.failed).length,
      failed: ops.filter((o) => o.failed).length,
      conflicts: conflicts.length,
    });
  }

  private setStatus(p: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...p };
    for (const fn of this.listeners) fn(this.status);
  }
}

/** Совпадают ли отправляемые данные с тем, что уже на сервере. */
function sameData(data: Row, server: Row): boolean {
  return Object.keys(data).every((k) => k === 'owner' || JSON.stringify(data[k] ?? null) === JSON.stringify(server[k] ?? null));
}
