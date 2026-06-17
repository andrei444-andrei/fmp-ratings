import { libsqlClient } from '@/db/client';

// СИГНАЛ как сохраняемая сущность: имя + определение (фактор, параметр, сторона, порог).
// Self-provisioning (§1 конституции), created_at обязателен.
let ensured = false;
export async function ensureSignalTables(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS signals_saved (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    def TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export type SavedSignal = { id: number; name: string; def: any; created_at: string };

export async function listSignals(): Promise<SavedSignal[]> {
  await ensureSignalTables();
  const r = await libsqlClient.execute(`SELECT id, name, def, created_at FROM signals_saved ORDER BY id DESC LIMIT 200`);
  return r.rows.map((x: any) => ({
    id: Number(x.id),
    name: String(x.name),
    def: safeParse(String(x.def)),
    created_at: String(x.created_at),
  }));
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function saveSignal(name: string, def: unknown): Promise<number> {
  await ensureSignalTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO signals_saved (name, def, created_at) VALUES (?, ?, ?)`,
    args: [name, JSON.stringify(def), now],
  });
  return Number(r.lastInsertRowid ?? 0);
}

export async function deleteSignal(id: number): Promise<void> {
  await ensureSignalTables();
  await libsqlClient.execute({ sql: `DELETE FROM signals_saved WHERE id = ?`, args: [id] });
}
