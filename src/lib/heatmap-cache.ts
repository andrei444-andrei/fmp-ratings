// Кэш датасета /heatmap (цены + grades) в Turso по ключу параметров.
// Цель: повторный запрос тех же параметров (особенно дефолтных) не ходит в FMP.

import { libsqlClient } from '@/db/client';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS heatmap_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    to_date TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  ensured = true;
}

export function heatmapCacheKey(p: {
  tickers: string[]; from: string; to: string; grades: boolean;
}): string {
  const tk = [...p.tickers].map(t => t.toUpperCase()).sort().join(',');
  return `${tk}|${p.from}|${p.to}|${p.grades ? 'g1' : 'g0'}`;
}

// Прошлые диапазоны (to < сегодня) неизменны — кэш бессрочный.
// Если to = сегодня, данные последнего дня ещё меняются → TTL 12 часов.
function isFresh(toDate: string, createdAt: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (toDate < today) return true;
  return Date.now() / 1000 - createdAt < 12 * 3600;
}

export async function getCachedDataset(key: string): Promise<{ payload: any; createdAt: number } | null> {
  await ensureSchema();
  const r = await libsqlClient.execute({
    sql: 'SELECT payload, to_date, created_at FROM heatmap_cache WHERE cache_key = ? LIMIT 1',
    args: [key],
  });
  const row = r.rows?.[0];
  if (!row) return null;
  const createdAt = Number(row.created_at);
  if (!isFresh(String(row.to_date), createdAt)) return null;
  try {
    return { payload: JSON.parse(String(row.payload)), createdAt };
  } catch { return null; }
}

export async function setCachedDataset(key: string, toDate: string, payload: any): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({
    sql: `INSERT INTO heatmap_cache (cache_key, payload, to_date, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload,
                                              to_date = excluded.to_date,
                                              created_at = excluded.created_at`,
    args: [key, JSON.stringify(payload), toDate, Math.floor(Date.now() / 1000)],
  });
}
