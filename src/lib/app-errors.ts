import { libsqlClient } from '@/db/client';

// Каноническая таблица логов (§2 конституции): один сток для всех ошибок,
// фиксированные имена/колонки. Self-provisioning, created_at обязателен (§1).
let ensured = false;
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
export async function logAppError(e: AppErrorInput): Promise<void> {
  try {
    await ensureAppErrorsTable();
    const now = new Date().toISOString();
    await libsqlClient.execute({
      sql: `INSERT INTO app_errors (ts, level, source, route, message, stack, build, user_agent, meta, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        now,
        e.level ?? 'error',
        e.source ?? 'server',
        e.route ?? null,
        (e.message ?? '').slice(0, 8000),
        e.stack ? e.stack.slice(0, 16000) : null,
        buildId(),
        e.user_agent ?? null,
        e.meta != null ? JSON.stringify(e.meta).slice(0, 16000) : null,
        now,
      ],
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
  const r = await libsqlClient.execute({
    sql: `SELECT id, ts, level, source, route, message, stack, build, user_agent, meta
          FROM app_errors ORDER BY id DESC LIMIT ?`,
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
