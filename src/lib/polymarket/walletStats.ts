// Статистика «edge над рынком» для кошелька Polymarket.
// Для каждого разрешённого пари edge = исход(0/1) − цена входа.
// Положительный средний edge со значимостью = есть предсказательная сила
// (учитывает шансы: ставки на фаворитов сами по себе edge не дают).

import type { CatKey } from './classify';

export type ResolvedBet = {
  conditionId: string;
  category: CatKey | null;
  horizonDays: number; // длительность рынка (для фильтра по горизонту)
  win: 0 | 1;          // выиграл ли исход, который держал кошелёк
  entry: number;       // средняя цена входа (avgPrice), 0..1
  pnl: number;         // реализованный PnL по рынку, $
  cost: number;        // вложено в рынок, $ (для ROI)
};

export type EdgeStats = {
  n: number;
  meanEdge: number;
  sd: number;
  tStat: number;
  pValue: number;     // одностороннее p (H1: средний edge > 0)
  significant: boolean;
  winRate: number;
  totalPnl: number;
  roi: number;        // totalPnl / суммарные вложения
};

// Нормальная CDF через приближение erf (достаточно для p-value).
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function edgeStats(bets: ResolvedBet[], minN = 20): EdgeStats {
  const n = bets.length;
  const empty: EdgeStats = {
    n, meanEdge: 0, sd: 0, tStat: 0, pValue: 1, significant: false,
    winRate: 0, totalPnl: 0, roi: 0,
  };
  if (n === 0) return empty;

  const edges = bets.map((b) => b.win - b.entry);
  const mean = edges.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? edges.reduce((a, e) => a + (e - mean) * (e - mean), 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n) || 1e-9;
  // ограничиваем t, чтобы при near-нулевой дисперсии не получить Infinity (ломает JSON/БД)
  const tStat = Math.max(-1e6, Math.min(1e6, mean / se));
  // одностороннее p: P(Z >= t) при H0 (средний edge = 0); нормальное приближение
  const pValue = 1 - normCdf(tStat);

  const wins = bets.reduce((a, b) => a + b.win, 0);
  const totalPnl = bets.reduce((a, b) => a + b.pnl, 0);
  const totalCost = bets.reduce((a, b) => a + Math.max(0, b.cost), 0);
  const roi = totalCost > 0 ? totalPnl / totalCost : 0;

  return {
    n,
    meanEdge: mean,
    sd,
    tStat,
    pValue,
    significant: n >= minN && mean > 0 && pValue < 0.05,
    winRate: wins / n,
    totalPnl,
    roi,
  };
}

// Разбивка по категориям событий (для фильтрации «умных денег» по типу).
export function statsByCategory(bets: ResolvedBet[], minN = 20): Record<string, EdgeStats> {
  const groups = new Map<string, ResolvedBet[]>();
  for (const b of bets) {
    const k = b.category ?? 'other';
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  const out: Record<string, EdgeStats> = {};
  for (const [k, arr] of groups) out[k] = edgeStats(arr, minN);
  return out;
}
