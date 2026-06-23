// Кэш собранного payload страницы Polymarket в Turso (TTL ~15 мин).
// Тяжёлая сборка (gamma + история + перевод) не повторяется на каждый заход.

import { libsqlClient } from '@/db/client';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS pm_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export async function cacheGet<T = any>(key: string, ttlMs: number): Promise<T | null> {
  try {
    await ensureSchema();
    const r = await libsqlClient.execute({
      sql: 'SELECT payload, created_at FROM pm_cache WHERE cache_key = ? LIMIT 1',
      args: [key],
    });
    const row = r.rows?.[0] as any;
    if (!row) return null;
    // created_at может быть ISO с 'Z' (наш INSERT) или 'YYYY-MM-DD HH:MM:SS' (default UTC)
    let ts = String(row.created_at).trim().replace(' ', 'T');
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(ts)) ts += 'Z';
    const created = new Date(ts).getTime();
    const age = Number.isFinite(created) ? Date.now() - created : Infinity;
    if (age > ttlMs) return null;
    return JSON.parse(String(row.payload)) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, payload: any): Promise<void> {
  try {
    await ensureSchema();
    await libsqlClient.execute({
      sql: `INSERT INTO pm_cache (cache_key, payload, created_at) VALUES (?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      args: [key, JSON.stringify(payload), new Date().toISOString()],
    });
  } catch {
    /* кэш недоступен — не критично */
  }
}
