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
    prompt_id INTEGER,
    title TEXT,
    prompt TEXT NOT NULL,
    code TEXT,
    status TEXT NOT NULL,
    result_html TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Идемпотентные миграции для БД, созданных раньше (дубль колонки тихо игнорируем).
  for (const col of ['title TEXT', 'prompt_id INTEGER']) {
    try {
      await libsqlClient.execute(`ALTER TABLE research_runs ADD COLUMN ${col}`);
    } catch {
      /* колонка уже есть */
    }
  }
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

export async function getPrompt(id: number): Promise<SavedPrompt | null> {
  await ensureResearchTables();
  const r = await libsqlClient.execute({
    sql: `SELECT id, title, prompt, created_at FROM research_prompts WHERE id = ?`,
    args: [id],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    prompt: String(x.prompt),
    created_at: String(x.created_at),
  };
}

export async function savePrompt(prompt: string, title: string): Promise<number> {
  await ensureResearchTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO research_prompts (title, prompt, created_at) VALUES (?, ?, ?)`,
    args: [title, prompt, now],
  });
  return Number(r.lastInsertRowid ?? 0);
}

export type SavedRunItem = { id: number; title: string | null; created_at: string };

export async function listRuns(): Promise<SavedRunItem[]> {
  await ensureResearchTables();
  const r = await libsqlClient.execute(
    `SELECT id, title, created_at FROM research_runs ORDER BY id DESC LIMIT 50`,
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    created_at: String(x.created_at),
  }));
}

export type SavedRun = {
  id: number;
  title: string | null;
  prompt: string;
  code: string | null;
  result_html: string | null;
  created_at: string;
};

export async function getRun(id: number): Promise<SavedRun | null> {
  await ensureResearchTables();
  const r = await libsqlClient.execute({
    sql: `SELECT id, title, prompt, code, result_html, created_at FROM research_runs WHERE id = ?`,
    args: [id],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    prompt: String(x.prompt),
    code: x.code != null ? String(x.code) : null,
    result_html: x.result_html != null ? String(x.result_html) : null,
    created_at: String(x.created_at),
  };
}

export async function saveRun(o: {
  promptId: number;
  title?: string | null;
  prompt: string;
  code: string | null;
  status: string;
  resultHtml: string | null;
  error?: string | null;
}): Promise<number> {
  await ensureResearchTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO research_runs (prompt_id, title, prompt, code, status, result_html, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [o.promptId, o.title ?? null, o.prompt, o.code, o.status, o.resultHtml, o.error ?? null, now],
  });
  return Number(r.lastInsertRowid ?? 0);
}
