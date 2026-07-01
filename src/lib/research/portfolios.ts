import { libsqlClient } from '@/db/client';

// «Портфель» — сохранённая КОМБИНАЦИЯ сетапов в одну стратегию: список id сетапов + правила сборки
// (взвешивание, лимит одновременных позиций, паркинг простоя). Метрики НЕ храним — считаем на лету
// по потокам сделок сетапов (см. portfolioEngine.ts + /api/researcher/portfolios/compute).
// Навсегда в Turso, created_at обязателен (§1). Зеркало сетапов/корзин: config — JSON в колонке.

export type Parking = 'BIL' | 'SPY' | 'CASH';
export type ExecMode = 'ladder' | 'weekly' | 'monthly';
export type PortfolioConfig = {
  setupIds: string[];
  selection: 'all'; // отбор: пока «все имена»; топ-K экстремумов / низкая корреляция — позже
  execution: ExecMode; // лестница / недельный / месячный ребаланс
  ladderN: number; // длина лестницы (дней удержания транша), актуально для execution='ladder'
  parking: Parking; // паркинг простоя
  maxWeight: number; // потолок веса на 1 тикер (доля 0..1); 0 = без лимита. Остаток сверх лимита → паркинг
};
// Снимок ключевых метрик последнего расчёта — чтобы список тестов показывал цифры без пересчёта.
export type PortfolioSnapshot = {
  cagr?: number | null; loading?: number | null; excessActive?: number | null; sharpe?: number | null;
  maxDD?: number | null; winRateVsSpy?: number | null; total?: number | null; start?: string | null; end?: string | null;
};
export type PortfolioRow = {
  id: string; name: string; description: string; config: PortfolioConfig;
  favorite: boolean; snapshot: PortfolioSnapshot | null; createdAt: string;
};

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
  // само-миграция: избранное + снимок метрик (для старых таблиц без этих колонок)
  const info = await libsqlClient.execute(`PRAGMA table_info(research_portfolios)`);
  const cols = new Set((info.rows as any[]).map((r) => String(r.name)));
  if (!cols.has('favorite')) await libsqlClient.execute(`ALTER TABLE research_portfolios ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0`);
  if (!cols.has('snapshot')) await libsqlClient.execute(`ALTER TABLE research_portfolios ADD COLUMN snapshot TEXT`);
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
  const execution: ExecMode = raw?.execution === 'weekly' ? 'weekly' : raw?.execution === 'monthly' ? 'monthly' : 'ladder';
  const ln = Number(raw?.ladderN);
  const ladderN = Number.isFinite(ln) && ln > 0 ? Math.min(60, Math.round(ln)) : 5;
  const mw = Number(raw?.maxWeight);
  const maxWeight = Number.isFinite(mw) && mw > 0 && mw < 1 ? Math.round(mw * 1000) / 1000 : 0; // 0 = без лимита; ≥1 бессмысленно
  return { setupIds, selection: 'all', execution, ladderN, parking, maxWeight };
}

const rowToPortfolio = (x: any): PortfolioRow => ({
  id: String(x.id),
  name: String(x.name),
  description: String(x.description ?? ''),
  config: normConfig(parseJson(String(x.config), {})),
  favorite: Number(x.favorite) === 1,
  snapshot: x.snapshot ? parseJson<PortfolioSnapshot | null>(String(x.snapshot), null) : null,
  createdAt: String(x.created_at ?? ''),
});

export async function listPortfolios(): Promise<PortfolioRow[]> {
  await ensurePortfoliosTable();
  // избранные сверху, затем по свежести обновления
  const r = await libsqlClient.execute(`SELECT id, name, description, config, favorite, snapshot, created_at FROM research_portfolios ORDER BY favorite DESC, updated_at DESC`);
  return (r.rows as any[]).map(rowToPortfolio);
}

export async function getPortfolio(id: string): Promise<PortfolioRow | null> {
  await ensurePortfoliosTable();
  const r = await libsqlClient.execute({ sql: `SELECT id, name, description, config, favorite, snapshot, created_at FROM research_portfolios WHERE id=?`, args: [String(id)] });
  const x = r.rows[0] as any;
  return x ? rowToPortfolio(x) : null;
}

export async function upsertPortfolio(p: { id: string; name: string; description?: string; config: any; snapshot?: PortfolioSnapshot; favorite?: boolean }): Promise<void> {
  await ensurePortfoliosTable();
  const id = String(p.id).slice(0, 80);
  const name = String(p.name).trim().slice(0, 64);
  const description = String(p.description ?? '').trim().slice(0, 512);
  if (!id || !name) throw new Error('id и name обязательны');
  const config = normConfig(p.config);
  if (!config.setupIds.length) throw new Error('нужен непустой список сетапов (setupIds)');
  const now = new Date().toISOString();
  // snapshot/favorite не переданы → сохраняем прежние значения (COALESCE) при обновлении
  const snap = p.snapshot !== undefined ? JSON.stringify(p.snapshot) : null;
  const fav = p.favorite === undefined ? null : p.favorite ? 1 : 0;
  await libsqlClient.execute({
    sql: `INSERT INTO research_portfolios (id, name, description, config, favorite, snapshot, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, config=excluded.config, updated_at=excluded.updated_at,
            favorite=COALESCE(?, research_portfolios.favorite), snapshot=COALESCE(?, research_portfolios.snapshot)`,
    args: [id, name, description, JSON.stringify(config), fav ?? 0, snap, now, now, fav, snap],
  });
}

// Точечное обновление метаданных теста без переписывания config/name (избранное и/или снимок метрик).
export async function updatePortfolioMeta(id: string, meta: { favorite?: boolean; snapshot?: PortfolioSnapshot }): Promise<void> {
  await ensurePortfoliosTable();
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (meta.favorite !== undefined) { sets.push('favorite=?'); args.push(meta.favorite ? 1 : 0); }
  if (meta.snapshot !== undefined) { sets.push('snapshot=?'); args.push(JSON.stringify(meta.snapshot)); }
  if (!sets.length) return;
  args.push(String(id));
  await libsqlClient.execute({ sql: `UPDATE research_portfolios SET ${sets.join(', ')} WHERE id=?`, args });
}

export async function deletePortfolio(id: string): Promise<void> {
  await ensurePortfoliosTable();
  await libsqlClient.execute({ sql: `DELETE FROM research_portfolios WHERE id=?`, args: [String(id)] });
}
