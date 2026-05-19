// Кэш итоговых ответов /api/ai/news по дате (источник + AI-итог).
// Лежит в Turso (libSQL) рядом с основной БД проекта.
// Исторические новости не меняются — кэш бессрочный.

import { libsqlClient } from '@/db/client';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS news_day_cache (
    date TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS api_usage_counter (
    name TEXT NOT NULL,
    period TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (name, period)
  )`);
  ensured = true;
}

export async function getCachedNews(date: string): Promise<{ source: string; payload: any; created_at: number } | null> {
  await ensureSchema();
  const r = await libsqlClient.execute({
    sql: 'SELECT source, payload, created_at FROM news_day_cache WHERE date = ? LIMIT 1',
    args: [date],
  });
  const row = r.rows?.[0];
  if (!row) return null;
  try {
    return {
      source: String(row.source),
      payload: JSON.parse(String(row.payload)),
      created_at: Number(row.created_at),
    };
  } catch { return null; }
}

export async function setCachedNews(date: string, source: string, payload: any): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({
    sql: `INSERT INTO news_day_cache (date, source, payload, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET source = excluded.source,
                                         payload = excluded.payload,
                                         created_at = excluded.created_at`,
    args: [date, source, JSON.stringify(payload), Math.floor(Date.now() / 1000)],
  });
}

// Месячный счётчик внешних API вызовов (для cap-логики).
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getApiUsage(name: string): Promise<number> {
  await ensureSchema();
  const r = await libsqlClient.execute({
    sql: 'SELECT n FROM api_usage_counter WHERE name = ? AND period = ?',
    args: [name, currentMonthKey()],
  });
  return Number(r.rows?.[0]?.n || 0);
}

export async function incApiUsage(name: string, by = 1): Promise<number> {
  await ensureSchema();
  const period = currentMonthKey();
  await libsqlClient.execute({
    sql: `INSERT INTO api_usage_counter (name, period, n)
          VALUES (?, ?, ?)
          ON CONFLICT(name, period) DO UPDATE SET n = n + ?`,
    args: [name, period, by, by],
  });
  return getApiUsage(name);
}
