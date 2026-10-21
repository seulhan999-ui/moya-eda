import type { SupabaseClient } from '@supabase/supabase-js';
import { TABLES, type Row, type TableName } from './tables';

/** Ошибка сети: операция остаётся в очереди и будет повторена. */
export class NetworkError extends Error {}
/** Ошибка данных (нарушено правило таблицы): повторять бессмысленно, нужен человек. */
export class DataError extends Error {}

/** Сервер с точки зрения синхронизации. Отдельный интерфейс — чтобы проверять движок без сети. */
export interface Remote {
  /** Вставить; повтор той же строки игнорируется. Возвращает строку сервера. */
  insert(table: TableName, data: Row): Promise<Row>;
  /** Обновить, только если версия на сервере равна baseVersion; иначе null. */
  updateIfVersion(table: TableName, pk: Row, data: Row, baseVersion: number): Promise<Row | null>;
  /** Перезаписать без проверки версии (восстановление из копии, выбор в конфликте). */
  upsert(table: TableName, data: Row): Promise<Row>;
  get(table: TableName, pk: Row): Promise<Row | null>;
  /** Строки, изменённые после since (включительно), по возрастанию. */
  pullSince(table: TableName, since: string, limit: number): Promise<Row[]>;
}

function classify(error: { code?: string; message: string } | null): never | void {
  if (!error) return;
  // Коды PostgreSQL классов 22 и 23 — неверные данные; 42501 — нет прав.
  if (error.code && /^(22|23|42)/.test(error.code)) throw new DataError(`${error.code}: ${error.message}`);
  throw new NetworkError(error.message);
}

export class SupabaseRemote implements Remote {
  private sb: SupabaseClient;
  constructor(sb: SupabaseClient) {
    this.sb = sb;
  }

  private async run<T>(p: PromiseLike<{ data: T; error: { code?: string; message: string } | null }>): Promise<T> {
    let res;
    try {
      res = await p;
    } catch (e) {
      throw new NetworkError(String(e));
    }
    classify(res.error);
    return res.data;
  }

  async insert(table: TableName, data: Row): Promise<Row> {
    const cfg = TABLES[table];
    await this.run(this.sb.from(table).upsert(data, { onConflict: cfg.conflict, ignoreDuplicates: true }));
    const pk = Object.fromEntries(cfg.pk.filter((k) => k !== 'owner').map((k) => [k, data[k]]));
    const row = await this.get(table, pk);
    if (!row) throw new NetworkError('Строка не найдена после вставки');
    return row;
  }

  async updateIfVersion(table: TableName, pk: Row, data: Row, baseVersion: number): Promise<Row | null> {
    const rows = await this.run(this.sb.from(table).update(data).match(pk).eq('version', baseVersion).select());
    return (rows as Row[])[0] ?? null;
  }

  async upsert(table: TableName, data: Row): Promise<Row> {
    const rows = await this.run(this.sb.from(table).upsert(data, { onConflict: TABLES[table].conflict }).select());
    return (rows as Row[])[0];
  }

  async get(table: TableName, pk: Row): Promise<Row | null> {
    const match = Object.fromEntries(Object.entries(pk).filter(([k]) => k !== 'owner'));
    const q = Object.keys(match).length ? this.sb.from(table).select('*').match(match) : this.sb.from(table).select('*');
    const rows = await this.run(q.limit(1));
    return (rows as Row[])[0] ?? null;
  }

  async pullSince(table: TableName, since: string, limit: number): Promise<Row[]> {
    const col = TABLES[table].cursor;
    const rows = await this.run(this.sb.from(table).select('*').gte(col, since).order(col).limit(limit));
    return rows as Row[];
  }
}
