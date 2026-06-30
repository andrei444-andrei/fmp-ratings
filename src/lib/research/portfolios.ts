import { libsqlClient } from '@/db/client';

// «Портфель» — сохранённая КОМБИНАЦИЯ сетапов в одну стратегию: список id сетапов + правила сборки
// (взвешивание, лимит одновременных позиций, паркинг простоя). Метрики НЕ храним — считаем на лету
// по потокам сделок сетапов (см. portfolioEngine.ts + /api/researcher/portfolios/compute).
// Навсегда в Turso, created_at обязателен (§1). Зеркало сетапов/корзин: config — JSON в колонке.

export type Parking = 'BIL' | 'SPY' | 'CASH';
export type PortfolioConfig = {
  setupIds: string[];
  weighting: 'equal';
  maxConcurrent: number | null; // лимит одновременных позиций (топ-K по эджу сетапа); null/0 — без лимита
  parking: Parking;
};
export type PortfolioRow = { id: string; name: string; description: string; config: PortfolioConfig };

let ensured = false;
export async function ensurePortfoliosTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS research_portfolios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    const v = JSON.parse(s);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function normConfig(raw: any): PortfolioConfig {
  const rawIds: string[] = Array.isArray(raw?.setupIds) ? raw.setupIds.map((x: any) => String(x)).filter(Boolean) : [];
  const setupIds = [...new Set(rawIds)].slice(0, 40);
  const parking: Parking = raw?.parking === 'SPY' ? 'SPY' : raw?.parking === 'CASH' ? 'CASH' : 'BIL';
  let maxConcurrent: number | null = null;
  const mc = Number(raw?.maxConcurrent);
  if (Number.isFinite(mc) && mc > 0) maxConcurrent = Math.min(50, Math.round(mc));
  return { setupIds, weighting: 'equal', maxConcurrent, parking };
}

export async function listPortfolios(): Promise<PortfolioRow[]> {
  await ensurePortfoliosTable();
  const r = await libsqlClient.execute(`SELECT id, name, description, config FROM research_portfolios ORDER BY created_at ASC`);
  return (r.rows as any[]).map((x) => ({
    id: String(x.id),
    name: String(x.name),
    description: String(x.description ?? ''),
    config: normConfig(parseJson(String(x.config), {})),
  }));
}

export async function getPortfolio(id: string): Promise<PortfolioRow | null> {
  await ensurePortfoliosTable();
  const r = await libsqlClient.execute({ sql: `SELECT id, name, description, config FROM research_portfolios WHERE id=?`, args: [String(id)] });
  const x = r.rows[0] as any;
  if (!x) return null;
  return { id: String(x.id), name: String(x.name), description: String(x.description ?? ''), config: normConfig(parseJson(String(x.config), {})) };
}

export async function upsertPortfolio(p: { id: string; name: string; description?: string; config: any }): Promise<void> {
  await ensurePortfoliosTable();
  const id = String(p.id).slice(0, 80);
  const name = String(p.name).trim().slice(0, 64);
  const description = String(p.description ?? '').trim().slice(0, 512);
  if (!id || !name) throw new Error('id и name обязательны');
  const config = normConfig(p.config);
  if (!config.setupIds.length) throw new Error('нужен непустой список сетапов (setupIds)');
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO research_portfolios (id, name, description, config, created_at, updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, config=excluded.config, updated_at=excluded.updated_at`,
    args: [id, name, description, JSON.stringify(config), now, now],
  });
}

export async function deletePortfolio(id: string): Promise<void> {
  await ensurePortfoliosTable();
  await libsqlClient.execute({ sql: `DELETE FROM research_portfolios WHERE id=?`, args: [String(id)] });
}
