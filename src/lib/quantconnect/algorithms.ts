// Портфель стратегий (qc_algorithms) в Turso. Каждая строка — стратегия QuantConnect:
// projectId (+ опц. backtestId), метка, описание и статус (active/research/archive).
// Схема создаётся лениво (как ticker_sets / si_*) + ленивая миграция колонок.

import { libsqlClient } from '@/db/client';
import { QC_STATUSES, type QcAlgorithm, type QcAlgoStatus } from './types';

function normStatus(v: any): QcAlgoStatus {
  const s = String(v ?? '').toLowerCase();
  return (QC_STATUSES as string[]).includes(s) ? (s as QcAlgoStatus) : 'active';
}

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS qc_algorithms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    backtest_id TEXT,
    name TEXT NOT NULL,
    benchmark TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Миграция существующих БД: SQLite не умеет ADD COLUMN IF NOT EXISTS —
  // гоним через try/catch, «duplicate column» игнорируем.
  for (const sql of [
    `ALTER TABLE qc_algorithms ADD COLUMN description TEXT`,
    `ALTER TABLE qc_algorithms ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
  ]) {
    try { await libsqlClient.execute(sql); } catch { /* колонка уже есть — ок */ }
  }
  ensured = true;
}

function rowToAlgo(r: any): QcAlgorithm {
  return {
    id: Number(r.id),
    projectId: String(r.project_id),
    backtestId: r.backtest_id ? String(r.backtest_id) : null,
    name: String(r.name),
    benchmark: r.benchmark ? String(r.benchmark) : null,
    description: r.description ? String(r.description) : null,
    status: normStatus(r.status),
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: String(r.created_at ?? ''),
  };
}

export async function listAlgorithms(): Promise<QcAlgorithm[]> {
  await ensureSchema();
  const r = await libsqlClient.execute(
    'SELECT id, project_id, backtest_id, name, benchmark, description, status, sort_order, created_at FROM qc_algorithms ORDER BY sort_order, id',
  );
  return (r.rows || []).map(rowToAlgo);
}

async function getById(id: number): Promise<QcAlgorithm | null> {
  const r = await libsqlClient.execute({
    sql: 'SELECT id, project_id, backtest_id, name, benchmark, description, status, sort_order, created_at FROM qc_algorithms WHERE id = ?',
    args: [id],
  });
  const row = r.rows?.[0];
  return row ? rowToAlgo(row) : null;
}

export async function addAlgorithm(input: {
  projectId?: string | number;
  backtestId?: string | null;
  name?: string;
  benchmark?: string | null;
  description?: string | null;
  status?: string | null;
}): Promise<{ algorithm?: QcAlgorithm; error?: string }> {
  await ensureSchema();
  const projectId = String(input.projectId ?? '').trim();
  if (!/^\d+$/.test(projectId)) return { error: 'projectId должен быть числом (ID проекта QuantConnect)' };
  const name = String(input.name ?? '').trim() || `Проект ${projectId}`;
  const backtestId = input.backtestId ? String(input.backtestId).trim() || null : null;
  const benchmark = input.benchmark ? String(input.benchmark).trim().toUpperCase() || null : null;
  const description = input.description ? String(input.description).trim() || null : null;
  const status = normStatus(input.status);

  const max = await libsqlClient.execute('SELECT COALESCE(MAX(sort_order), -1) AS m FROM qc_algorithms');
  const sortOrder = Number((max.rows?.[0] as any)?.m ?? -1) + 1;
  const now = new Date().toISOString();

  const ins = await libsqlClient.execute({
    sql: `INSERT INTO qc_algorithms (project_id, backtest_id, name, benchmark, description, status, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [projectId, backtestId, name, benchmark, description, status, sortOrder, now],
  });
  const id = Number(ins.lastInsertRowid ?? 0);
  return { algorithm: { id, projectId, backtestId, name, benchmark, description, status, sortOrder, createdAt: now } };
}

// Правка метки / описания / статуса (только переданные поля).
export async function updateAlgorithm(
  id: number,
  patch: { name?: string; description?: string | null; status?: string },
): Promise<{ algorithm?: QcAlgorithm; error?: string }> {
  await ensureSchema();
  const sets: string[] = [];
  const args: any[] = [];
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) return { error: 'Метка не может быть пустой' };
    sets.push('name = ?'); args.push(name);
  }
  if (patch.description !== undefined) {
    const d = patch.description ? String(patch.description).trim() || null : null;
    sets.push('description = ?'); args.push(d);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?'); args.push(normStatus(patch.status));
  }
  if (!sets.length) return { error: 'Нечего обновлять' };
  args.push(id);
  await libsqlClient.execute({ sql: `UPDATE qc_algorithms SET ${sets.join(', ')} WHERE id = ?`, args });
  const algorithm = await getById(id);
  return algorithm ? { algorithm } : { error: 'Стратегия не найдена' };
}

export async function removeAlgorithm(id: number): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({ sql: 'DELETE FROM qc_algorithms WHERE id = ?', args: [id] });
}
