// Подключение к Supabase и запуск синхронизации для вошедшего пользователя.

import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { LocalDb } from './localdb';
import { NetworkError, SupabaseRemote, type Remote } from './remote';
import { SyncEngine } from './sync';
import { TABLE_NAMES } from './tables';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const PERIODIC_MS = 30_000;

/** Синхронизация живёт, пока пользователь вошёл. stop() — при выходе. */
export interface SyncSession {
  engine: SyncEngine;
  db: LocalDb;
  stop: () => void;
}

export async function startSync(userId: string): Promise<SyncSession> {
  // Отдельное локальное хранилище на каждого пользователя.
  const db = await LocalDb.open(`moya-eda-${userId}`);
  const engine = new SyncEngine(db, new SupabaseRemote(supabase), userId);
  await engine.refreshStatus();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (ms = 300) => {
    clearTimeout(timer);
    timer = setTimeout(() => void engine.sync(), ms);
  };

  const onOnline = () => soon(0);
  const onVisible = () => {
    if (document.visibilityState === 'visible') soon(0);
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => soon(0), PERIODIC_MS);

  // Мгновенные уведомления об изменениях с другого устройства.
  let channel: RealtimeChannel = supabase.channel(`changes-${userId}`);
  for (const table of TABLE_NAMES) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => soon());
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') soon(0);
  });

  soon(0);

  return {
    engine,
    db,
    stop: () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
      db.close();
    },
  };
}

/**
 * Демо-режим только для разработки (адрес ?demo на localhost): локальные данные без сервера,
 * чтобы проверять экраны без входа в настоящий аккаунт. В сборку для публикации не попадает.
 */
export async function startDemo(): Promise<SyncSession> {
  const db = await LocalDb.open('moya-eda-demo');
  const offline: Remote = {
    insert: () => Promise.reject(new NetworkError('демо без сервера')),
    updateIfVersion: () => Promise.reject(new NetworkError('демо без сервера')),
    upsert: () => Promise.reject(new NetworkError('демо без сервера')),
    get: () => Promise.reject(new NetworkError('демо без сервера')),
    pullSince: () => Promise.reject(new NetworkError('демо без сервера')),
  };
  const engine = new SyncEngine(db, offline, 'demo-user');
  await engine.refreshStatus();
  return { engine, db, stop: () => db.close() };
}

/** После любого локального изменения — отправить как можно скорее. */
export function syncSoon(s: SyncSession): void {
  void s.engine.sync();
}
