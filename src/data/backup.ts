// Резервная копия: полный экспорт данных с версией формата и проверкой при импорте.
// Повреждённый файл не меняет текущие данные. Перед восстановлением делается копия текущего состояния.

import { nowIso, uuid } from './ids';
import type { LocalDb } from './localdb';
import { TABLE_NAMES, TABLES, payload, pkKey, type Row, type TableName } from './tables';

export const BACKUP_FORMAT = 'moya-eda-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  tables: Partial<Record<TableName, Row[]>>;
  /** Фото: ключ — путь в хранилище, значение — data URL. Пусто, пока фото не добавлены. */
  photos: Record<string, string>;
  /** Есть ли в копии фото (копия без фото так и называется). */
  withPhotos: boolean;
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  counts: Partial<Record<TableName, number>>;
  createdAt?: string;
  withPhotos?: boolean;
}

export async function exportBackup(db: LocalDb, photos: Record<string, string> = {}): Promise<Backup> {
  const tables: Backup['tables'] = {};
  for (const t of TABLE_NAMES) tables[t] = await db.all(t);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: nowIso(), tables, photos, withPhotos: Object.keys(photos).length > 0 };
}

/** Проверить файл копии до восстановления: состав и ошибки. */
export function checkBackup(raw: unknown): BackupCheck {
  const errors: string[] = [];
  const counts: BackupCheck['counts'] = {};
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Файл не похож на копию «Моя еда»'], counts };
  const b = raw as Partial<Backup>;
  if (b.format !== BACKUP_FORMAT) errors.push('Неизвестный формат файла');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) errors.push('Копия сделана более новой версией приложения');
  if (!b.tables || typeof b.tables !== 'object') errors.push('В копии нет данных');
  else {
    for (const [t, rows] of Object.entries(b.tables)) {
      if (!(t in TABLES)) { errors.push(`Неизвестная таблица: ${t}`); continue; }
      if (!Array.isArray(rows)) { errors.push(`${t}: повреждены данные`); continue; }
      const bad = rows.findIndex((r) => !r || typeof r !== 'object' || TABLES[t as TableName].pk.some((k) => k !== 'owner' && (r as Row)[k] == null));
      if (bad >= 0) errors.push(`${t}: повреждена запись №${bad + 1}`);
      counts[t as TableName] = rows.length;
    }
  }
  return { ok: errors.length === 0, errors, counts, createdAt: b.createdAt, withPhotos: b.withPhotos };
}

/**
 * Восстановить данные из проверенной копии. Строки ставятся в очередь как «восстановление»:
 * сервер получает их без проверки версии. Владелец заменяется на текущего пользователя.
 */
export async function restoreBackup(db: LocalDb, backup: Backup, owner: string): Promise<void> {
  const check = checkBackup(backup);
  if (!check.ok) throw new Error(check.errors.join('; '));
  await db.clearRows();
  for (const t of TABLE_NAMES) {
    for (const r of backup.tables[t] ?? []) {
      const data = payload({ ...r, owner });
      const key = pkKey(t, data);
      await db.putWithOp(t, key, data, {
        opId: uuid(), table: t, key, kind: TABLES[t].mode === 'append' ? 'insert' : 'restore',
        data, attempts: 0, createdAt: nowIso(),
      });
    }
  }
}
