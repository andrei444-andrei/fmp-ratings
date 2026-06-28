import { libsqlClient } from '@/db/client';

// Постоянное хранилище вычисляемых метрик (формул) скринера — в Turso (НЕ в кеше/localStorage),
// чтобы формулы сохранялись навсегда. Единая библиотека (инструмент админский, без пользователей).
// created_at обязателен (§1 конституции).

export type FormulaRow = { id: string; name: string; expr: string };

let ensured = false;
export async function ensureFormulasTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS research_formulas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    expr TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export async function listFormulas(): Promise<FormulaRow[]> {
  await ensureFormulasTable();
  const r = await libsqlClient.execute(`SELECT id, name, expr FROM research_formulas ORDER BY created_at ASC`);
  return (r.rows as any[]).map((x) => ({ id: String(x.id), name: String(x.name), expr: String(x.expr) }));
}

export async function upsertFormula(f: FormulaRow): Promise<void> {
  await ensureFormulasTable();
  const id = String(f.id).slice(0, 80);
  const name = String(f.name).trim().slice(0, 64);
  const expr = String(f.expr).trim().slice(0, 512);
  if (!id || !name || !expr) throw new Error('id, name и expr обязательны');
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO research_formulas (id, name, expr, created_at, updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, expr=excluded.expr, updated_at=excluded.updated_at`,
    args: [id, name, expr, now, now],
  });
}

export async function deleteFormula(id: string): Promise<void> {
  await ensureFormulasTable();
  await libsqlClient.execute({ sql: `DELETE FROM research_formulas WHERE id=?`, args: [String(id)] });
}
