// Snapshot-first кэш overview (docs §6). Таблица самопровижинится (§1), created_at
// обязателен. Payload — gzip+base64 c префиксом 'gz:' (как в signals/store). Всё graceful:
// нет БД/ключей → читаем/пишем no-op, фича работает на синтетике.
import { gzipSync, gunzipSync } from 'node:zlib';
import { libsqlClient } from '@/db/client';

// Версия формата метрик: бамп → старые снапшоты «промахиваются» и пересобираются.
// '2': добавлена корреляционная матрица + sparkT в payload — старые снапшоты промахиваются.
// '3': добавлена общая доходность корзины (BlockMetrics.agg) — старые снапшоты без agg промахиваются.
export const TERMINAL_EPOCH = '3';
export const SNAPSHOT_TTL_MS = 45 * 60 * 1000; // EOD-данные; обновляем не чаще ~45 мин

let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS market_snapshot (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    as_of TEXT,
    epoch TEXT NOT NULL,
    refreshed_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

function pack(obj: unknown): string {
  return 'gz:' + gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
}
function unpack(s: string): unknown {
  if (s.startsWith('gz:')) return JSON.parse(gunzipSync(Buffer.from(s.slice(3), 'base64')).toString('utf8'));
  return JSON.parse(s);
}

export type SnapshotRow<T> = { payload: T; refreshedAt: number };

/** Читает снапшот. Возвращает null при промахе/недоступной БД (graceful). */
export async function readSnapshot<T>(key: string): Promise<SnapshotRow<T> | null> {
  try {
    await ensureTable();
    const r = await libsqlClient.execute({
      sql: `SELECT payload, refreshed_at FROM market_snapshot WHERE key=? AND epoch=?`,
      args: [key, TERMINAL_EPOCH],
    });
    const row = r.rows[0] as any;
    if (!row) return null;
    return { payload: unpack(String(row.payload)) as T, refreshedAt: Date.parse(String(row.refreshed_at)) || 0 };
  } catch {
    return null; // нет БД — работаем без кэша
  }
}

/** Пишет снапшот. Тихо игнорирует ошибки БД (graceful). */
export async function writeSnapshot(key: string, payload: unknown, asOf: string): Promise<void> {
  try {
    await ensureTable();
    const now = new Date().toISOString();
    await libsqlClient.execute({
      sql: `INSERT INTO market_snapshot (key, payload, as_of, epoch, refreshed_at, created_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, as_of=excluded.as_of,
              epoch=excluded.epoch, refreshed_at=excluded.refreshed_at`,
      args: [key, pack(payload), asOf, TERMINAL_EPOCH, now, now],
    });
  } catch {
    /* нет БД — пропускаем кэширование */
  }
}

export function isFresh(refreshedAt: number): boolean {
  return Date.now() - refreshedAt < SNAPSHOT_TTL_MS;
}
