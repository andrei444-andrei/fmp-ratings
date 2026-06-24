// Хранилище «умных денег» в Turso:
//  - pm_wallet_candidates — пул кандидатов (резюмируемый краул);
//  - pm_wallet_bets — сами события (разрешённые пари) по каждому кошельку;
//  - pm_smart_wallets — мета (стоимость портфеля, AI-summary) + кэш агрегата.
// Лидерборд пересчитывается из событий на лету под выбранный горизонт.
// Самопровижининг (§1 конституции).

import { libsqlClient } from '@/db/client';
import { edgeStats, statsByCategory, type ResolvedBet } from './walletStats';
import type { CatKey } from './classify';

const SIG_MIN_N = 20; // минимум пари для оценки значимости

// libsql отвергает Infinity/NaN — приводим к конечному числу.
const fin = (x: number, d = 0): number => (Number.isFinite(x) ? x : d);

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.batch([
    `CREATE TABLE IF NOT EXISTS pm_wallet_candidates (
      address TEXT PRIMARY KEY,
      seen INTEGER NOT NULL DEFAULT 1,
      scored INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pm_smart_wallets (
      address TEXT PRIMARY KEY,
      n INTEGER NOT NULL,
      mean_edge REAL NOT NULL,
      t_stat REAL NOT NULL,
      p_value REAL NOT NULL,
      significant INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      total_pnl REAL NOT NULL,
      roi REAL NOT NULL,
      value_usd REAL NOT NULL,
      by_cat TEXT,
      min_horizon REAL NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pm_wallet_bets (
      address TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      question TEXT,
      category TEXT,
      horizon_days REAL NOT NULL,
      entry REAL NOT NULL,
      win INTEGER NOT NULL,
      pnl REAL NOT NULL,
      cost REAL NOT NULL,
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (address, condition_id)
    )`,
  ], 'write');
  // ai_summary добавляем мягко (ALTER без IF NOT EXISTS в SQLite)
  try { await libsqlClient.execute(`ALTER TABLE pm_smart_wallets ADD COLUMN ai_summary TEXT`); } catch { /* уже есть */ }
  ensured = true;
}

export async function addCandidates(addresses: string[]): Promise<void> {
  const uniq = Array.from(new Set(addresses.filter(Boolean)));
  if (!uniq.length) return;
  await ensureSchema();
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    await libsqlClient.batch(
      chunk.map((a) => ({
        sql: `INSERT INTO pm_wallet_candidates (address, seen) VALUES (?, 1)
              ON CONFLICT(address) DO UPDATE SET seen = seen + 1`,
        args: [a],
      })),
      'write',
    );
  }
}

export async function nextUnscored(limit: number): Promise<string[]> {
  await ensureSchema();
  const r = await libsqlClient.execute({
    sql: `SELECT address FROM pm_wallet_candidates WHERE scored = 0 ORDER BY seen DESC, address LIMIT ?`,
    args: [limit],
  });
  return (r.rows as any[]).map((x) => String(x.address));
}

export async function markScored(addresses: string[]): Promise<void> {
  if (!addresses.length) return;
  await ensureSchema();
  await libsqlClient.batch(
    addresses.map((a) => ({ sql: `UPDATE pm_wallet_candidates SET scored = 1 WHERE address = ?`, args: [a] })),
    'write',
  );
}

// --- события (разрешённые пари) ---

export type StoredBet = {
  conditionId: string; question: string; category: string | null;
  horizonDays: number; entry: number; win: 0 | 1; pnl: number; cost: number; endDate: string | null;
};

export async function storeWalletBets(address: string, bets: StoredBet[]): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({ sql: 'DELETE FROM pm_wallet_bets WHERE address = ?', args: [address] });
  if (!bets.length) return;
  for (let i = 0; i < bets.length; i += 100) {
    const chunk = bets.slice(i, i + 100);
    await libsqlClient.batch(
      chunk.map((b) => ({
        sql: `INSERT INTO pm_wallet_bets (address, condition_id, question, category, horizon_days, entry, win, pnl, cost, end_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(address, condition_id) DO UPDATE SET
                question=excluded.question, category=excluded.category, horizon_days=excluded.horizon_days,
                entry=excluded.entry, win=excluded.win, pnl=excluded.pnl, cost=excluded.cost, end_date=excluded.end_date`,
        args: [address, b.conditionId, b.question, b.category, fin(b.horizonDays, 3650), fin(b.entry), b.win, fin(b.pnl), fin(b.cost), b.endDate],
      })),
      'write',
    );
  }
}

function rowToStoredBet(x: any): StoredBet {
  return {
    conditionId: String(x.condition_id), question: String(x.question ?? ''),
    category: x.category ?? null, horizonDays: Number(x.horizon_days),
    entry: Number(x.entry), win: (Number(x.win) ? 1 : 0) as 0 | 1,
    pnl: Number(x.pnl), cost: Number(x.cost), endDate: x.end_date ?? null,
  };
}

export async function loadBets(address: string): Promise<StoredBet[]> {
  await ensureSchema();
  const r = await libsqlClient.execute({ sql: 'SELECT * FROM pm_wallet_bets WHERE address = ?', args: [address] });
  return (r.rows as any[]).map(rowToStoredBet);
}

async function loadAllBetsGrouped(): Promise<Map<string, StoredBet[]>> {
  await ensureSchema();
  const r = await libsqlClient.execute('SELECT * FROM pm_wallet_bets');
  const map = new Map<string, StoredBet[]>();
  for (const x of r.rows as any[]) {
    const addr = String(x.address);
    (map.get(addr) ?? map.set(addr, []).get(addr)!).push(rowToStoredBet(x));
  }
  return map;
}

// --- мета кошелька (стоимость портфеля, AI-summary) ---

export async function upsertWalletMeta(address: string, valueUsd: number, agg: {
  n: number; meanEdge: number; tStat: number; pValue: number; significant: boolean;
  winRate: number; totalPnl: number; roi: number; byCat: any; minHorizon: number;
}): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({
    sql: `INSERT INTO pm_smart_wallets
      (address, n, mean_edge, t_stat, p_value, significant, win_rate, total_pnl, roi, value_usd, by_cat, min_horizon, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        n=excluded.n, mean_edge=excluded.mean_edge, t_stat=excluded.t_stat, p_value=excluded.p_value,
        significant=excluded.significant, win_rate=excluded.win_rate, total_pnl=excluded.total_pnl,
        roi=excluded.roi, value_usd=excluded.value_usd, by_cat=excluded.by_cat,
        min_horizon=excluded.min_horizon, computed_at=excluded.computed_at`,
    args: [address, agg.n, fin(agg.meanEdge), fin(agg.tStat), fin(agg.pValue, 1), agg.significant ? 1 : 0, fin(agg.winRate),
      fin(agg.totalPnl), fin(agg.roi), fin(valueUsd), JSON.stringify(agg.byCat), fin(agg.minHorizon, 30), new Date().toISOString()],
  });
}

export async function setAiSummary(address: string, summary: string): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({ sql: 'UPDATE pm_smart_wallets SET ai_summary = ? WHERE address = ?', args: [summary, address] });
}

async function loadMeta(): Promise<Map<string, { valueUsd: number; aiSummary: string | null }>> {
  const r = await libsqlClient.execute('SELECT address, value_usd, ai_summary FROM pm_smart_wallets');
  const map = new Map<string, { valueUsd: number; aiSummary: string | null }>();
  for (const x of r.rows as any[]) map.set(String(x.address), { valueUsd: Number(x.value_usd), aiSummary: x.ai_summary ?? null });
  return map;
}

// --- лидерборд (пересчёт из событий под выбранный горизонт) ---

export type CatStat = { n: number; meanEdge: number; tStat: number; significant: boolean; winRate: number; totalPnl: number };
export type WalletRow = {
  address: string; n: number; meanEdge: number; tStat: number; pValue: number;
  significant: boolean; winRate: number; totalPnl: number; roi: number; valueUsd: number;
  byCat: Record<string, CatStat>; minHorizon: number; aiSummary: string | null;
  samples: { question: string; category: string | null; win: 0 | 1; entry: number; pnl: number }[];
};

export type ListOpts = { category?: string; minN?: number; sigOnly?: boolean; limit?: number; minHorizon?: number };

function toResolved(b: StoredBet): ResolvedBet {
  return { conditionId: b.conditionId, category: (b.category as CatKey | null), horizonDays: b.horizonDays, win: b.win, entry: b.entry, pnl: b.pnl, cost: b.cost };
}

export async function listWallets(opts: ListOpts = {}): Promise<WalletRow[]> {
  await ensureSchema();
  const limit = Math.min(opts.limit ?? 100, 300);
  const minHorizon = opts.minHorizon ?? 30;
  const minN = opts.minN ?? 1;

  const grouped = await loadAllBetsGrouped();
  const meta = await loadMeta();

  let rows: WalletRow[] = [];
  for (const [address, allBets] of grouped) {
    const bets = allBets.filter((b) => b.horizonDays >= minHorizon);
    if (!bets.length) continue;
    const resolved = bets.map(toResolved);
    const o = edgeStats(resolved, SIG_MIN_N);
    const byCatStats = statsByCategory(resolved, SIG_MIN_N);
    const byCat: Record<string, CatStat> = {};
    for (const [k, s] of Object.entries(byCatStats)) {
      byCat[k] = { n: s.n, meanEdge: s.meanEdge, tStat: s.tStat, significant: s.significant, winRate: s.winRate, totalPnl: s.totalPnl };
    }
    const samples = [...bets].sort((a, b) => b.cost - a.cost).slice(0, 6)
      .map((b) => ({ question: b.question, category: b.category, win: b.win, entry: b.entry, pnl: b.pnl }));
    const m = meta.get(address);
    rows.push({
      address, n: o.n, meanEdge: o.meanEdge, tStat: o.tStat, pValue: o.pValue, significant: o.significant,
      winRate: o.winRate, totalPnl: o.totalPnl, roi: o.roi, valueUsd: m?.valueUsd ?? 0,
      byCat, minHorizon, aiSummary: m?.aiSummary ?? null, samples,
    });
  }

  if (opts.category && opts.category !== 'all') {
    const cat = opts.category;
    rows = rows
      .filter((w) => w.byCat[cat] && w.byCat[cat].n >= minN)
      .filter((w) => !opts.sigOnly || w.byCat[cat].significant)
      .sort((a, b) => (b.byCat[cat].significant ? 1 : 0) - (a.byCat[cat].significant ? 1 : 0) || b.byCat[cat].meanEdge - a.byCat[cat].meanEdge);
  } else {
    if (minN > 1) rows = rows.filter((w) => w.n >= minN);
    if (opts.sigOnly) rows = rows.filter((w) => w.significant);
    rows.sort((a, b) => (b.significant ? 1 : 0) - (a.significant ? 1 : 0) || b.meanEdge - a.meanEdge);
  }
  return rows.slice(0, limit);
}

export async function resetScored(): Promise<void> {
  await ensureSchema();
  await libsqlClient.batch(
    ['DELETE FROM pm_smart_wallets', 'DELETE FROM pm_wallet_bets', 'UPDATE pm_wallet_candidates SET scored = 0'],
    'write',
  );
}

export async function progress(): Promise<{ candidates: number; scored: number; smart: number }> {
  await ensureSchema();
  const c = await libsqlClient.execute('SELECT COUNT(*) c, SUM(scored) s FROM pm_wallet_candidates');
  const s = await libsqlClient.execute('SELECT COUNT(*) c FROM pm_smart_wallets');
  const cr = c.rows[0] as any, sr = s.rows[0] as any;
  return { candidates: Number(cr?.c ?? 0), scored: Number(cr?.s ?? 0), smart: Number(sr?.c ?? 0) };
}
