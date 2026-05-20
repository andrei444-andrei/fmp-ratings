// Кэш раздела superinvestor в Turso. Тяжёлые данные (13F-холдинги, цены,
// посчитанные сводки) кэшируются по ключу, чтобы не дёргать FMP повторно.
// Прошлые периоды (to < сегодня) неизменны — кэш бессрочный; для to = сегодня TTL 12ч.

import { libsqlClient } from '@/db/client';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS si_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    to_date TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  ensured = true;
}

function isFresh(toDate: string, createdAt: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (toDate < today) return true;
  return Date.now() / 1000 - createdAt < 12 * 3600;
}

export async function siCacheGet<T = any>(key: string): Promise<T | null> {
  try {
    await ensureSchema();
    const r = await libsqlClient.execute({
      sql: 'SELECT payload, to_date, created_at FROM si_cache WHERE cache_key = ? LIMIT 1',
      args: [key],
    });
    const row = r.rows?.[0];
    if (!row) return null;
    if (!isFresh(String(row.to_date), Number(row.created_at))) return null;
    return JSON.parse(String(row.payload)) as T;
  } catch {
    return null;
  }
}

export async function siCacheSet(key: string, toDate: string, payload: any): Promise<void> {
  try {
    await ensureSchema();
    await libsqlClient.execute({
      sql: `INSERT INTO si_cache (cache_key, payload, to_date, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload,
                                                to_date = excluded.to_date,
                                                created_at = excluded.created_at`,
      args: [key, JSON.stringify(payload), toDate, Math.floor(Date.now() / 1000)],
    });
  } catch { /* кэш недоступен — не критично */ }
}
