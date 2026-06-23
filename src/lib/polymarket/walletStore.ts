// Хранилище «умных денег» в Turso: кандидаты (для резюмируемого краула) и
// посчитанные кошельки с edge-статистикой. Самопровижининг (§1 конституции).

import { libsqlClient } from '@/db/client';

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
  ], 'write');
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

// Следующие неотсканированные кандидаты — приоритет по частоте появления (seen).
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

export type WalletRow = {
  address: string;
  n: number;
  meanEdge: number;
  tStat: number;
  pValue: number;
  significant: boolean;
  winRate: number;
  totalPnl: number;
  roi: number;
  valueUsd: number;
  byCat: Record<string, { n: number; meanEdge: number; tStat: number; significant: boolean; winRate: number; totalPnl: number }>;
  minHorizon: number;
};

export async function upsertWallet(w: WalletRow): Promise<void> {
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
    args: [
      w.address, w.n, w.meanEdge, w.tStat, w.pValue, w.significant ? 1 : 0, w.winRate,
      w.totalPnl, w.roi, w.valueUsd, JSON.stringify(w.byCat), w.minHorizon, new Date().toISOString(),
    ],
  });
}

export type ListOpts = { category?: string; minN?: number; sigOnly?: boolean; limit?: number };

export async function listWallets(opts: ListOpts = {}): Promise<WalletRow[]> {
  await ensureSchema();
  const limit = Math.min(opts.limit ?? 100, 300);
  const r = await libsqlClient.execute({
    sql: `SELECT * FROM pm_smart_wallets ORDER BY (significant) DESC, mean_edge DESC LIMIT 500`,
    args: [],
  });
  let rows = (r.rows as any[]).map(rowToWallet);
  if (opts.category && opts.category !== 'all') {
    rows = rows
      .filter((w) => w.byCat[opts.category!] && w.byCat[opts.category!].n >= (opts.minN ?? 1))
      .sort((a, b) => {
        const A = a.byCat[opts.category!], B = b.byCat[opts.category!];
        return (B.significant ? 1 : 0) - (A.significant ? 1 : 0) || B.meanEdge - A.meanEdge;
      });
  } else {
    if (opts.minN) rows = rows.filter((w) => w.n >= opts.minN!);
    if (opts.sigOnly) rows = rows.filter((w) => w.significant);
  }
  return rows.slice(0, limit);
}

function rowToWallet(x: any): WalletRow {
  let byCat: WalletRow['byCat'] = {};
  try { byCat = JSON.parse(x.by_cat || '{}'); } catch { /* ignore */ }
  return {
    address: String(x.address),
    n: Number(x.n),
    meanEdge: Number(x.mean_edge),
    tStat: Number(x.t_stat),
    pValue: Number(x.p_value),
    significant: !!x.significant,
    winRate: Number(x.win_rate),
    totalPnl: Number(x.total_pnl),
    roi: Number(x.roi),
    valueUsd: Number(x.value_usd),
    byCat,
    minHorizon: Number(x.min_horizon),
  };
}

export async function progress(): Promise<{ candidates: number; scored: number; smart: number }> {
  await ensureSchema();
  const c = await libsqlClient.execute('SELECT COUNT(*) c, SUM(scored) s FROM pm_wallet_candidates');
  const s = await libsqlClient.execute('SELECT COUNT(*) c FROM pm_smart_wallets');
  const cr = c.rows[0] as any, sr = s.rows[0] as any;
  return { candidates: Number(cr?.c ?? 0), scored: Number(cr?.s ?? 0), smart: Number(sr?.c ?? 0) };
}
