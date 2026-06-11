// Портфель алгоритмов (qc_algorithms) в Turso. Каждая строка — алгоритм QuantConnect:
// projectId (+ опц. backtestId, иначе берём последний завершённый бектест) и метка.
// Схема создаётся лениво (как ticker_sets / si_*).

import { libsqlClient } from '@/db/client';
import type { QcAlgorithm } from './types';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS qc_algorithms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    backtest_id TEXT,
    name TEXT NOT NULL,
    benchmark TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

function rowToAlgo(r: any): QcAlgorithm {
  return {
    id: Number(r.id),
    projectId: String(r.project_id),
    backtestId: r.backtest_id ? String(r.backtest_id) : null,
    name: String(r.name),
    benchmark: r.benchmark ? String(r.benchmark) : null,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: String(r.created_at ?? ''),
  };
}

export async function listAlgorithms(): Promise<QcAlgorithm[]> {
  await ensureSchema();
  const r = await libsqlClient.execute(
    'SELECT id, project_id, backtest_id, name, benchmark, sort_order, created_at FROM qc_algorithms ORDER BY sort_order, id',
  );
  return (r.rows || []).map(rowToAlgo);
}

export async function addAlgorithm(input: {
  projectId?: string | number;
  backtestId?: string | null;
  name?: string;
  benchmark?: string | null;
}): Promise<{ algorithm?: QcAlgorithm; error?: string }> {
  await ensureSchema();
  const projectId = String(input.projectId ?? '').trim();
  if (!/^\d+$/.test(projectId)) return { error: 'projectId должен быть числом (ID проекта QuantConnect)' };
  const name = String(input.name ?? '').trim() || `Проект ${projectId}`;
  const backtestId = input.backtestId ? String(input.backtestId).trim() || null : null;
  const benchmark = input.benchmark ? String(input.benchmark).trim().toUpperCase() || null : null;

  const max = await libsqlClient.execute('SELECT COALESCE(MAX(sort_order), -1) AS m FROM qc_algorithms');
  const sortOrder = Number((max.rows?.[0] as any)?.m ?? -1) + 1;
  const now = new Date().toISOString();

  const ins = await libsqlClient.execute({
    sql: `INSERT INTO qc_algorithms (project_id, backtest_id, name, benchmark, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [projectId, backtestId, name, benchmark, sortOrder, now],
  });
  const id = Number(ins.lastInsertRowid ?? 0);
  return { algorithm: { id, projectId, backtestId, name, benchmark, sortOrder, createdAt: now } };
}

export async function removeAlgorithm(id: number): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({ sql: 'DELETE FROM qc_algorithms WHERE id = ?', args: [id] });
}
