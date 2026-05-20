// База данных собранных AI-событий + сохранённые шаблоны промптов.
// Лежит в Turso (libSQL) рядом с остальными данными. Схема создаётся лениво.

import { libsqlClient } from '@/db/client';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ai_events_db (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    source TEXT,
    created_at INTEGER NOT NULL
  )`);
  // Дедуп по (date, title) — одно и то же событие не дублируется между запусками.
  await libsqlClient.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_events_dt ON ai_events_db (date, title)`
  );
  await libsqlClient.execute(`CREATE INDEX IF NOT EXISTS idx_ai_events_date ON ai_events_db (date)`);
  await libsqlClient.execute(`CREATE INDEX IF NOT EXISTS idx_ai_events_cat ON ai_events_db (category)`);

  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ai_event_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    system TEXT NOT NULL,
    user_tpl TEXT NOT NULL,
    model TEXT,
    query TEXT,
    categories TEXT,
    temperature REAL,
    max_tokens INTEGER,
    updated_at INTEGER NOT NULL
  )`);
  ensured = true;
}

export type DbEvent = {
  date: string;
  category: string;
  title: string;
  description?: string;
  source?: string;
};

export async function insertEvents(events: DbEvent[]): Promise<number> {
  await ensureSchema();
  if (!events.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;
  // INSERT OR IGNORE — дубликаты по (date,title) тихо пропускаются.
  for (const e of events) {
    if (!e.date || !e.title) continue;
    const r = await libsqlClient.execute({
      sql: `INSERT OR IGNORE INTO ai_events_db (date, category, title, description, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [e.date, e.category || 'other', e.title, e.description || null, e.source || null, now],
    });
    inserted += Number(r.rowsAffected || 0);
  }
  return inserted;
}

export async function listEvents(opts: {
  from?: string; to?: string; category?: string; limit?: number; offset?: number;
} = {}): Promise<DbEvent[]> {
  await ensureSchema();
  const where: string[] = [];
  const args: any[] = [];
  if (opts.from) { where.push('date >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('date <= ?'); args.push(opts.to); }
  if (opts.category) { where.push('category = ?'); args.push(opts.category); }
  const limit = Math.max(1, Math.min(5000, opts.limit ?? 1000));
  const offset = Math.max(0, opts.offset ?? 0);
  const sql = `SELECT date, category, title, description, source FROM ai_events_db
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY date ASC LIMIT ? OFFSET ?`;
  const r = await libsqlClient.execute({ sql, args: [...args, limit, offset] });
  return (r.rows || []).map((row: any) => ({
    date: String(row.date),
    category: String(row.category),
    title: String(row.title),
    description: row.description != null ? String(row.description) : undefined,
    source: row.source != null ? String(row.source) : undefined,
  }));
}

export async function countEvents(): Promise<{ total: number; byCategory: Record<string, number>; minDate?: string; maxDate?: string }> {
  await ensureSchema();
  const t = await libsqlClient.execute('SELECT COUNT(*) AS n, MIN(date) AS mn, MAX(date) AS mx FROM ai_events_db');
  const c = await libsqlClient.execute('SELECT category, COUNT(*) AS n FROM ai_events_db GROUP BY category');
  const byCategory: Record<string, number> = {};
  for (const row of (c.rows || [])) byCategory[String((row as any).category)] = Number((row as any).n);
  const row0: any = t.rows?.[0];
  return {
    total: Number(row0?.n || 0),
    byCategory,
    minDate: row0?.mn ? String(row0.mn) : undefined,
    maxDate: row0?.mx ? String(row0.mx) : undefined,
  };
}

export async function clearEvents(): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute('DELETE FROM ai_events_db');
}

// ===== Шаблоны промптов =====

export type Template = {
  id?: number;
  name: string;
  system: string;
  userTpl: string;
  model?: string;
  query?: string;
  categories?: string;
  temperature?: number;
  maxTokens?: number;
};

export async function saveTemplate(t: Template): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({
    sql: `INSERT INTO ai_event_templates (name, system, user_tpl, model, query, categories, temperature, max_tokens, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            system = excluded.system, user_tpl = excluded.user_tpl, model = excluded.model,
            query = excluded.query, categories = excluded.categories,
            temperature = excluded.temperature, max_tokens = excluded.max_tokens,
            updated_at = excluded.updated_at`,
    args: [t.name, t.system, t.userTpl, t.model || null, t.query || null,
           t.categories || null, t.temperature ?? null, t.maxTokens ?? null,
           Math.floor(Date.now() / 1000)],
  });
}

export async function listTemplates(): Promise<Template[]> {
  await ensureSchema();
  const r = await libsqlClient.execute(
    'SELECT id, name, system, user_tpl, model, query, categories, temperature, max_tokens FROM ai_event_templates ORDER BY name'
  );
  return (r.rows || []).map((row: any) => ({
    id: Number(row.id),
    name: String(row.name),
    system: String(row.system),
    userTpl: String(row.user_tpl),
    model: row.model != null ? String(row.model) : undefined,
    query: row.query != null ? String(row.query) : undefined,
    categories: row.categories != null ? String(row.categories) : undefined,
    temperature: row.temperature != null ? Number(row.temperature) : undefined,
    maxTokens: row.max_tokens != null ? Number(row.max_tokens) : undefined,
  }));
}

export async function deleteTemplate(name: string): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({ sql: 'DELETE FROM ai_event_templates WHERE name = ?', args: [name] });
}
