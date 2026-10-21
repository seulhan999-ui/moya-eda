import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDb } from './localdb';
import { NetworkError, type Remote } from './remote';
import { SyncEngine } from './sync';
import { TABLES, type Row, type TableName } from './tables';
import { checkBackup, exportBackup, restoreBackup } from './backup';
import { uuid } from './ids';

/** Сервер в памяти с теми же правилами: версия растёт при каждом изменении, op_id уникален. */
class FakeRemote implements Remote {
  rows = new Map<string, Row>();
  offline = false;
  clock = 0;
  calls = 0;

  private key(table: TableName, r: Row) {
    return table + ':' + TABLES[table].pk.filter((k) => k !== 'owner').map((k) => r[k]).join('|');
  }
  private ts() {
    return new Date(Date.UTC(2026, 9, 21, 0, 0, 0, ++this.clock)).toISOString();
  }
  private check() {
    this.calls++;
    if (this.offline) throw new NetworkError('нет сети');
  }
  async insert(table: TableName, data: Row) {
    this.check();
    if (TABLES[table].conflict.includes('op_id')) {
      const dup = [...this.rows.entries()].find(([k, r]) => k.startsWith(table + ':') && r.op_id === data.op_id);
      if (dup) return dup[1];
    }
    const k = this.key(table, data);
    if (!this.rows.has(k)) this.rows.set(k, { ...data, version: 1, updated_at: this.ts(), server_at: this.ts() });
    return this.rows.get(k)!;
  }
  async updateIfVersion(table: TableName, pk: Row, data: Row, base: number) {
    this.check();
    const k = this.key(table, pk);
    const cur = this.rows.get(k);
    if (!cur || cur.version !== base) return null;
    const next = { ...cur, ...data, version: (cur.version as number) + 1, updated_at: this.ts() };
    this.rows.set(k, next);
    return next;
  }
  async upsert(table: TableName, data: Row) {
    this.check();
    const k = this.key(table, data);
    const cur = this.rows.get(k);
    const next = { ...data, version: cur ? (cur.version as number) + 1 : 1, updated_at: this.ts(), server_at: this.ts() };
    this.rows.set(k, next);
    return next;
  }
  async get(table: TableName, pk: Row) {
    this.check();
    return this.rows.get(this.key(table, pk)) ?? null;
  }
  async pullSince(table: TableName, since: string, limit: number) {
    this.check();
    const col = TABLES[table].cursor;
    return [...this.rows.entries()]
      .filter(([k, r]) => k.startsWith(table + ':') && (r[col] as string) >= since)
      .map(([, r]) => r)
      .sort((a, b) => ((a[col] as string) < (b[col] as string) ? -1 : 1))
      .slice(0, limit);
  }
}

const OWNER = 'user-1';
let server: FakeRemote;
let phone: SyncEngine;
let pc: SyncEngine;
let phoneDb: LocalDb;
let pcDb: LocalDb;

beforeEach(async () => {
  server = new FakeRemote();
  phoneDb = await LocalDb.open('phone-' + uuid());
  pcDb = await LocalDb.open('pc-' + uuid());
  phone = new SyncEngine(phoneDb, server, OWNER);
  pc = new SyncEngine(pcDb, server, OWNER);
});

describe('AC15 — синхронизация двух устройств', () => {
  it('запись с телефона появляется на компьютере', async () => {
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-21', kg: 82.4 });
    await phone.sync();
    await pc.sync();
    const rows = await pc.list('weight_entries');
    expect(rows).toHaveLength(1);
    expect(rows[0].kg).toBe(82.4);
  });

  it('правка на компьютере доходит до телефона, удаление — тоже', async () => {
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-21', kg: 82.4 });
    await phone.sync();
    await pc.sync();
    const [row] = await pc.list('weight_entries');
    await pc.save('weight_entries', { ...row, kg: 82.1 });
    await pc.sync();
    await phone.sync();
    expect((await phone.list('weight_entries'))[0].kg).toBe(82.1);
    await pc.remove('weight_entries', (await pc.list('weight_entries'))[0]);
    await pc.sync();
    await phone.sync();
    expect(await phone.list('weight_entries')).toHaveLength(0);
  });
});

describe('AC16 — без сети и повторная отправка', () => {
  it('изменение без сети сохраняется и видно в очереди, после связи уходит один раз', async () => {
    server.offline = true;
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-21', kg: 80 });
    await phone.sync();
    expect(phone.getStatus().state).toBe('offline');
    expect(phone.getStatus().pending).toBe(1);
    expect(await phone.list('weight_entries')).toHaveLength(1); // данные на месте
    server.offline = false;
    await phone.sync();
    expect(phone.getStatus().pending).toBe(0);
    expect([...server.rows.keys()].filter((k) => k.startsWith('weight_entries'))).toHaveLength(1);
  });

  it('повторная отправка одной операции журнала не создаёт копию', async () => {
    const mv = { op_id: 'buy-1', ingredient_id: 'buckwheat', delta: 500, kind: 'purchase', at: '2026-10-21T10:00:00Z' };
    await phone.append('stock_movements', mv);
    await phone.append('stock_movements', mv); // повтор той же покупки (например, двойное нажатие при обрыве сети)
    await phone.sync();
    const stored = [...server.rows.values()].filter((r) => r.op_id === 'buy-1');
    expect(stored).toHaveLength(1);
    expect(await phone.list('stock_movements')).toHaveLength(1);
  });

  it('та же операция, отправленная с двух устройств, хранится один раз и на сервере, и на устройствах', async () => {
    const mv = { op_id: 'cook-7:buckwheat', ingredient_id: 'buckwheat', delta: -300, kind: 'cook', at: 't' };
    await phone.append('stock_movements', mv);
    await pc.append('stock_movements', mv);
    await phone.sync();
    await pc.sync();
    await phone.sync();
    expect([...server.rows.values()].filter((r) => r.op_id === mv.op_id)).toHaveLength(1);
    expect(await pc.list('stock_movements')).toHaveLength(1);
    expect(await phone.list('stock_movements')).toHaveLength(1);
  });

  it('несколько правок без сети объединяются в одну отправку', async () => {
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-21', kg: 80 });
    await phone.sync();
    server.offline = true;
    const [r] = await phone.list('weight_entries');
    await phone.save('weight_entries', { ...r, kg: 79.5 });
    await phone.save('weight_entries', { ...r, kg: 79.2 });
    expect(phone.getStatus().pending).toBe(1);
    server.offline = false;
    await phone.sync();
    expect(server.rows.get('weight_entries:w1')!.kg).toBe(79.2);
    expect(server.rows.get('weight_entries:w1')!.version).toBe(2);
  });
});

describe('AC17 — конфликт', () => {
  it('одновременная правка одного значения не теряет ни один вариант, выбор за пользователем', async () => {
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-21', kg: 80 });
    await phone.sync();
    await pc.sync();
    const [a] = await phone.list('weight_entries');
    const [b] = await pc.list('weight_entries');
    await phone.save('weight_entries', { ...a, kg: 79 });
    await pc.save('weight_entries', { ...b, kg: 81 });
    await phone.sync(); // успел первым
    await pc.sync(); // конфликт
    const conflicts = await pc.conflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.kg).toBe(81);
    expect(conflicts[0].server!.kg).toBe(79);
    await pc.resolve(conflicts[0].id, 'local');
    await pc.sync();
    await phone.sync();
    expect((await phone.list('weight_entries'))[0].kg).toBe(81);
    expect(await pc.conflicts()).toHaveLength(0);
  });

  it('независимые записи с двух устройств объединяются без конфликта', async () => {
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-20', kg: 80 });
    await pc.save('weight_entries', { id: 'w2', day: '2026-10-21', kg: 79.8 });
    await phone.sync();
    await pc.sync();
    await phone.sync();
    expect(await phone.list('weight_entries')).toHaveLength(2);
    expect(await pc.list('weight_entries')).toHaveLength(2);
    expect(await pc.conflicts()).toHaveLength(0);
  });
});

describe('AC23 — резервная копия', () => {
  it('экспорт → очистка → восстановление воспроизводит данные', async () => {
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-21', kg: 80 });
    await phone.save('taste_ratings', { recipe_id: 'bulgur', rating: 'tasty', favorite: true, never_suggest: false });
    await phone.append('stock_movements', { op_id: 'b1', ingredient_id: 'buckwheat', delta: 500, kind: 'purchase', at: 't' });
    await phone.sync();
    const backup = JSON.parse(JSON.stringify(await exportBackup(phoneDb)));
    expect(checkBackup(backup).ok).toBe(true);

    const freshDb = await LocalDb.open('fresh-' + uuid());
    const fresh = new SyncEngine(freshDb, new FakeRemote(), OWNER);
    await restoreBackup(freshDb, backup, OWNER);
    await fresh.sync();
    expect((await fresh.list('weight_entries'))[0].kg).toBe(80);
    expect((await fresh.list('taste_ratings'))[0].favorite).toBe(true);
    expect(await fresh.list('stock_movements')).toHaveLength(1);
  });

  it('повреждённый файл не проходит проверку и не меняет данные', async () => {
    await phone.save('weight_entries', { id: 'w1', day: '2026-10-21', kg: 80 });
    expect(checkBackup({ hello: 'world' }).ok).toBe(false);
    const broken = { format: 'moya-eda-backup', version: 1, tables: { weight_entries: [{ kg: 1 }] } };
    expect(checkBackup(broken).ok).toBe(false);
    await expect(restoreBackup(phoneDb, broken as never, OWNER)).rejects.toThrow();
    expect(await phone.list('weight_entries')).toHaveLength(1);
  });
});
