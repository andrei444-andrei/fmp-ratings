import { randomUUID } from 'crypto';
import { libsqlClient } from '@/db/client';

// Каноническая таблица логов (§2 конституции): один сток для всех ошибок,
// фиксированные имена/колонки. Self-provisioning, created_at обязателен (§1).
//
// ВАЖНО: БД может быть общей с другим проектом, где app_errors создана с ИНОЙ схемой
// (например id TEXT-UUID и без created_at). CREATE TABLE IF NOT EXISTS тогда no-op, а наш
// жёсткий INSERT падал на несуществующей колонке → ошибки молча не писались. Поэтому при
// записи подстраиваемся под ФАКТИЧЕСКИЕ колонки таблицы (интроспекция).
let ensured = false;
let tableColumns: Set<string> | null = null;
let idNeedsValue = false; // true, если PK id не автоинкрементный INTEGER (нужно задавать самим)

export async function ensureAppErrorsTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS app_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL DEFAULT 'error',
    source TEXT NOT NULL DEFAULT 'server',
    route TEXT,
    message TEXT NOT NULL,
    stack TEXT,
    build TEXT,
    user_agent TEXT,
    meta TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  try {
    const info = await libsqlClient.execute('PRAGMA table_info(app_errors)');
    const cols = new Set<string>();
    let idType = '';
    for (const r of info.rows as any[]) {
      const name = String(r.name);
      cols.add(name);
      if (name === 'id') idType = String(r.type ?? '').toUpperCase();
    }
    tableColumns = cols;
    // INTEGER PK автоинкрементный — id назначит сама БД; иначе (TEXT/UUID) задаём UUID.
    idNeedsValue = cols.has('id') && idType !== 'INTEGER';
  } catch {
    tableColumns = null; // не удалось интроспектировать — пишем по канонической схеме
  }
  ensured = true;
}

function buildId(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    'local'
  );
}

export type AppErrorInput = {
  level?: 'error' | 'warn' | 'info';
  source?: 'server' | 'client';
  route?: string | null;
  message: string;
  stack?: string | null;
  user_agent?: string | null;
  meta?: unknown;
};

// Пишет ошибку в app_errors. Сам себя не валит (§1): провал записи лога — тихий.
// INSERT строится под фактические колонки таблицы (см. ensureAppErrorsTable), чтобы
// запись не падала, если схема общей БД отличается (нет created_at, id — UUID и т.п.).
export async function logAppError(e: AppErrorInput): Promise<void> {
  try {
    await ensureAppErrorsTable();
    const now = new Date().toISOString();
    const candidate: Record<string, unknown> = {
      id: idNeedsValue ? randomUUID() : undefined,
      ts: now,
      level: e.level ?? 'error',
      source: e.source ?? 'server',
      route: e.route ?? null,
      message: (e.message ?? '').slice(0, 8000),
      stack: e.stack ? e.stack.slice(0, 16000) : null,
      build: buildId(),
      user_agent: e.user_agent ?? null,
      meta: e.meta != null ? JSON.stringify(e.meta).slice(0, 16000) : null,
      created_at: now,
    };
    // Берём только колонки, которые реально есть в таблице (или все — если интроспекция не удалась).
    const keys = Object.keys(candidate).filter(
      (k) => candidate[k] !== undefined && (!tableColumns || tableColumns.has(k)),
    );
    await libsqlClient.execute({
      sql: `INSERT INTO app_errors (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      args: keys.map((k) => candidate[k] as any),
    });
  } catch (err) {
    console.error('[app_errors] log write failed', err);
  }
}

export type AppErrorRow = {
  id: number;
  ts: string;
  level: string;
  source: string;
  route: string | null;
  message: string;
  stack: string | null;
  build: string | null;
  user_agent: string | null;
  meta: string | null;
};

export async function getRecentErrors(limit = 100): Promise<AppErrorRow[]> {
  await ensureAppErrorsTable();
  const n = Math.min(Math.max(1, Math.trunc(limit) || 100), 500);
  // Сортируем по ts (id может быть UUID — тогда ORDER BY id не по времени).
  const r = await libsqlClient.execute({
    sql: `SELECT id, ts, level, source, route, message, stack, build, user_agent, meta
          FROM app_errors ORDER BY ts DESC LIMIT ?`,
    args: [n],
  });
  return r.rows.map((x: any) => ({
    id: Number(x.id),
    ts: String(x.ts),
    level: String(x.level),
    source: String(x.source),
    route: x.route != null ? String(x.route) : null,
    message: String(x.message),
    stack: x.stack != null ? String(x.stack) : null,
    build: x.build != null ? String(x.build) : null,
    user_agent: x.user_agent != null ? String(x.user_agent) : null,
    meta: x.meta != null ? String(x.meta) : null,
  }));
}
