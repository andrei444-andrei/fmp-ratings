import { gzipSync, gunzipSync } from 'node:zlib';
import { libsqlClient } from '@/db/client';

// Снимок отчёта по большой вселенной (S&P 500 × параметры × столбцы с дрилл-дауном) — это
// мегабайты JSON. Несжатый INSERT в Turso по HTTP может не пролезть → «сохранение пропадает».
// Поэтому payload пакуем gzip+base64 (≈×5–10). Префикс 'gz:' — чтобы читать и старые несжатые строки.
function packPayload(payload: unknown): string {
  return 'gz:' + gzipSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64');
}
function unpackPayload(raw: string): any {
  if (raw.startsWith('gz:')) {
    try {
      return JSON.parse(gunzipSync(Buffer.from(raw.slice(3), 'base64')).toString('utf8'));
    } catch {
      return null;
    }
  }
  return safeParse(raw);
}

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
  // Снимок результата исследования (JSON payload) — чтобы открыть без пересчёта.
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS signal_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    payload TEXT NOT NULL,
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

// ─── Снимки результатов ───
export type SavedResultItem = { id: number; title: string; mode: string; created_at: string };

export async function listResults(): Promise<SavedResultItem[]> {
  await ensureSignalTables();
  const r = await libsqlClient.execute(`SELECT id, title, mode, created_at FROM signal_results ORDER BY id DESC LIMIT 100`);
  return r.rows.map((x: any) => ({
    id: Number(x.id),
    title: String(x.title),
    mode: String(x.mode),
    created_at: String(x.created_at),
  }));
}

export async function getResult(id: number): Promise<{ id: number; title: string; mode: string; payload: any } | null> {
  await ensureSignalTables();
  const r = await libsqlClient.execute({ sql: `SELECT id, title, mode, payload FROM signal_results WHERE id = ?`, args: [id] });
  const x = r.rows[0] as any;
  if (!x) return null;
  return { id: Number(x.id), title: String(x.title), mode: String(x.mode), payload: unpackPayload(String(x.payload)) };
}

export async function saveResult(title: string, mode: string, payload: unknown): Promise<number> {
  await ensureSignalTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO signal_results (title, mode, payload, created_at) VALUES (?, ?, ?, ?)`,
    args: [title, mode, packPayload(payload), now],
  });
  return Number(r.lastInsertRowid ?? 0);
}

export async function deleteResult(id: number): Promise<void> {
  await ensureSignalTables();
  await libsqlClient.execute({ sql: `DELETE FROM signal_results WHERE id = ?`, args: [id] });
}

export async function renameResult(id: number, title: string): Promise<void> {
  await ensureSignalTables();
  await libsqlClient.execute({ sql: `UPDATE signal_results SET title = ? WHERE id = ?`, args: [title, id] });
}
