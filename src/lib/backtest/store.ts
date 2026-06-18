import { libsqlClient } from '@/db/client';

// Self-provisioning (§1 конституции): таблица создаётся лениво, единый источник правды —
// этот CREATE. created_at обязателен. Храним конфиг (JSON), код стратегии и снимок HTML-вывода.
let ensured = false;
export async function ensureBacktestTables(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS backtest_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    config TEXT NOT NULL,
    strategy TEXT NOT NULL,
    status TEXT NOT NULL,
    result_html TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export type SavedBacktestRunItem = { id: number; title: string | null; created_at: string };

export async function listBacktestRuns(): Promise<SavedBacktestRunItem[]> {
  await ensureBacktestTables();
  const r = await libsqlClient.execute(
    `SELECT id, title, created_at FROM backtest_runs ORDER BY id DESC LIMIT 50`,
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    created_at: String(x.created_at),
  }));
}

export type SavedBacktestRun = {
  id: number;
  title: string | null;
  description: string | null;
  config: string;
  strategy: string;
  result_html: string | null;
  created_at: string;
};

export async function getBacktestRun(id: number): Promise<SavedBacktestRun | null> {
  await ensureBacktestTables();
  const r = await libsqlClient.execute({
    sql: `SELECT id, title, description, config, strategy, result_html, created_at FROM backtest_runs WHERE id = ?`,
    args: [id],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    description: x.description != null ? String(x.description) : null,
    config: String(x.config),
    strategy: String(x.strategy),
    result_html: x.result_html != null ? String(x.result_html) : null,
    created_at: String(x.created_at),
  };
}

export async function saveBacktestRun(o: {
  title: string;
  description?: string | null;
  config: string;
  strategy: string;
  resultHtml: string | null;
}): Promise<number> {
  await ensureBacktestTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO backtest_runs (title, description, config, strategy, status, result_html, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [o.title, o.description ?? null, o.config, o.strategy, 'saved', o.resultHtml, now],
  });
  return Number(r.lastInsertRowid ?? 0);
}

export async function updateBacktestRun(
  id: number,
  o: { title?: string | null; description?: string | null },
): Promise<void> {
  await ensureBacktestTables();
  const sets: string[] = [];
  const args: any[] = [];
  if (o.title !== undefined) {
    sets.push('title = ?');
    args.push(o.title);
  }
  if (o.description !== undefined) {
    sets.push('description = ?');
    args.push(o.description);
  }
  if (!sets.length) return;
  args.push(id);
  await libsqlClient.execute({ sql: `UPDATE backtest_runs SET ${sets.join(', ')} WHERE id = ?`, args });
}

export async function deleteBacktestRun(id: number): Promise<void> {
  await ensureBacktestTables();
  await libsqlClient.execute({ sql: `DELETE FROM backtest_runs WHERE id = ?`, args: [id] });
}
