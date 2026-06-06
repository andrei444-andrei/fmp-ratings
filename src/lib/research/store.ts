import { libsqlClient } from '@/db/client';

// Self-provisioning (§1): таблицы создаются лениво, единый источник правды —
// этот CREATE (без дублирования в Drizzle-схеме). created_at обязателен (§1).
let ensured = false;
export async function ensureResearchTables(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS research_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    prompt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS research_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    code TEXT,
    status TEXT NOT NULL,
    result_html TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export type SavedPrompt = { id: number; title: string | null; prompt: string; created_at: string };

export async function listPrompts(): Promise<SavedPrompt[]> {
  await ensureResearchTables();
  const r = await libsqlClient.execute(
    `SELECT id, title, prompt, created_at FROM research_prompts ORDER BY id DESC LIMIT 50`,
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    prompt: String(x.prompt),
    created_at: String(x.created_at),
  }));
}

export async function savePrompt(prompt: string, title?: string | null): Promise<number> {
  await ensureResearchTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO research_prompts (title, prompt, created_at) VALUES (?, ?, ?)`,
    args: [title ?? null, prompt, now],
  });
  return Number(r.lastInsertRowid ?? 0);
}

export async function saveRun(o: {
  prompt: string;
  code: string | null;
  status: string;
  resultHtml: string | null;
  error?: string | null;
}): Promise<void> {
  await ensureResearchTables();
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO research_runs (prompt, code, status, result_html, error, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [o.prompt, o.code, o.status, o.resultHtml, o.error ?? null, now],
  });
}
