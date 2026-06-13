// Настройки раздела QuantConnect (key-value JSON) в Turso. Напр. конфиг
// объединённого портфеля (веса/состав). Схема создаётся лениво.

import { libsqlClient } from '@/db/client';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS qc_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export async function getSetting<T = any>(key: string): Promise<T | null> {
  try {
    await ensureSchema();
    const r = await libsqlClient.execute({ sql: 'SELECT value FROM qc_settings WHERE key = ? LIMIT 1', args: [key] });
    const row = r.rows?.[0] as any;
    if (!row) return null;
    return JSON.parse(String(row.value)) as T;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: any): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({
    sql: `INSERT INTO qc_settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, JSON.stringify(value ?? null), new Date().toISOString()],
  });
}
