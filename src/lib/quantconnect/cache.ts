// Кэш посчитанных годовых метрик бектеста (qc_backtest_cache) в Turso.
// Завершённый бектест неизменен → кэш по backtestId бессрочный. Сброс — через ?force=1.

import { libsqlClient } from '@/db/client';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS qc_backtest_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export async function qcCacheGet<T = any>(key: string): Promise<T | null> {
  try {
    await ensureSchema();
    const r = await libsqlClient.execute({
      sql: 'SELECT payload FROM qc_backtest_cache WHERE cache_key = ? LIMIT 1',
      args: [key],
    });
    const row = r.rows?.[0] as any;
    if (!row) return null;
    return JSON.parse(String(row.payload)) as T;
  } catch {
    return null;
  }
}

// Удаляет строки кэша по LIKE-шаблону (best-effort) — для чистки устаревших ключей.
export async function qcCacheDeleteLike(pattern: string): Promise<void> {
  try {
    await ensureSchema();
    await libsqlClient.execute({ sql: 'DELETE FROM qc_backtest_cache WHERE cache_key LIKE ?', args: [pattern] });
  } catch { /* запись недоступна — не критично */ }
}

export async function qcCacheSet(key: string, payload: any): Promise<void> {
  try {
    await ensureSchema();
    await libsqlClient.execute({
      sql: `INSERT INTO qc_backtest_cache (cache_key, payload, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      args: [key, JSON.stringify(payload), new Date().toISOString()],
    });
  } catch {
    /* кэш недоступен — не критично */
  }
}
