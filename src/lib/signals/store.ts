import { libsqlClient } from '@/db/client';

// Self-provisioning (§1 конституции): таблица создаётся лениво, единый источник правды —
// этот CREATE. created_at обязателен. Храним конфиг модели (JSON) + снимок HTML-вывода.
let ensured = false;
export async function ensureSignalTables(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS signal_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    config TEXT NOT NULL,
    status TEXT NOT NULL,
    result_html TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export type SavedSignalRunItem = { id: number; title: string | null; created_at: string };

export async function listSignalRuns(): Promise<SavedSignalRunItem[]> {
  await ensureSignalTables();
  const r = await libsqlClient.execute(
    `SELECT id, title, created_at FROM signal_runs ORDER BY id DESC LIMIT 50`,
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    created_at: String(x.created_at),
  }));
}

export type SavedSignalRun = {
  id: number;
  title: string | null;
  description: string | null;
  config: string;
  result_html: string | null;
  created_at: string;
};

export async function getSignalRun(id: number): Promise<SavedSignalRun | null> {
  await ensureSignalTables();
  const r = await libsqlClient.execute({
    sql: `SELECT id, title, description, config, result_html, created_at FROM signal_runs WHERE id = ?`,
    args: [id],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    description: x.description != null ? String(x.description) : null,
    config: String(x.config),
    result_html: x.result_html != null ? String(x.result_html) : null,
    created_at: String(x.created_at),
  };
}

export async function saveSignalRun(o: {
  title: string;
  description?: string | null;
  config: string;
  resultHtml: string | null;
}): Promise<number> {
  await ensureSignalTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO signal_runs (title, description, config, status, result_html, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [o.title, o.description ?? null, o.config, 'saved', o.resultHtml, now],
  });
  return Number(r.lastInsertRowid ?? 0);
}

export async function updateSignalRun(
  id: number,
  o: { title?: string | null; description?: string | null },
): Promise<void> {
  await ensureSignalTables();
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
  await libsqlClient.execute({ sql: `UPDATE signal_runs SET ${sets.join(', ')} WHERE id = ?`, args });
}

export async function deleteSignalRun(id: number): Promise<void> {
  await ensureSignalTables();
  await libsqlClient.execute({ sql: `DELETE FROM signal_runs WHERE id = ?`, args: [id] });
}
