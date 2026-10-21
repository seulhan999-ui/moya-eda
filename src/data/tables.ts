// Описание синхронизируемых таблиц Supabase.

export type Row = Record<string, unknown>;

export interface TableConfig {
  /** Поля первичного ключа (owner добавляется сервером через RLS). */
  pk: string[];
  /** versioned — обычная таблица с проверкой версии; append — журнал только на добавление. */
  mode: 'versioned' | 'append';
  /** Поле, по которому забираются изменения с сервера. */
  cursor: 'updated_at' | 'server_at';
  /** Поля конфликта для повторной вставки (идемпотентность). */
  conflict: string;
}

export const TABLES = {
  profiles: { pk: ['owner'], mode: 'versioned', cursor: 'updated_at', conflict: 'owner' },
  food_preferences: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'id' },
  ingredients: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'owner,id' },
  recipes: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'owner,id' },
  meal_plans: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'id' },
  planned_meals: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'id' },
  food_entries: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'owner,op_id' },
  stock_movements: { pk: ['id'], mode: 'append', cursor: 'server_at', conflict: 'owner,op_id' },
  pantry_meta: { pk: ['ingredient_id'], mode: 'versioned', cursor: 'updated_at', conflict: 'owner,ingredient_id' },
  shopping_manual: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'id' },
  store_prices: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'id' },
  taste_ratings: { pk: ['recipe_id'], mode: 'versioned', cursor: 'updated_at', conflict: 'owner,recipe_id' },
  weight_entries: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'id' },
  import_jobs: { pk: ['id'], mode: 'versioned', cursor: 'updated_at', conflict: 'id' },
} as const satisfies Record<string, TableConfig>;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

/** Поля, которые заполняет только сервер. */
export const SERVER_FIELDS = ['version', 'updated_at', 'server_at'];

export function pkOf(table: TableName, row: Row): Record<string, unknown> {
  return Object.fromEntries(TABLES[table].pk.map((k) => [k, row[k]]));
}

export function pkKey(table: TableName, row: Row): string {
  return TABLES[table].pk.map((k) => String(row[k])).join('|');
}

/** Данные строки без серверных полей — то, что отправляется на сервер. */
export function payload(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!SERVER_FIELDS.includes(k)) out[k] = v;
  return out;
}
