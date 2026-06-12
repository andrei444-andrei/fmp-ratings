// Объединение нескольких стратегий в портфель (помесячный ребаланс с весами).
// Client-safe: чистые функции над месячными рядами капитала.

import { computeYearly } from './metrics';
import type { MonthPoint, YearMetric } from './types';

export type CombineInput = { id: number; monthly: MonthPoint[]; weight: number };

export type CombinedResult = {
  months: string[];               // общие месяцы (с доходностью у всех выбранных)
  equity: number[];               // длина months.length+1, старт = 1
  benchEquity: number[] | null;   // выровнен по тем же месяцам (старт = 1)
  yearly: YearMetric[];           // годовые метрики комбинированной кривой
  benchYearly: YearMetric[] | null;
  total: number | null;
  cagr: number | null;
  maxDD: number | null;
  stdYear: number | null;
  years: number;                  // длительность в годах (months/12)
  bench: { total: number | null; cagr: number | null; maxDD: number | null } | null;
};

function monthlyReturns(monthly: MonthPoint[]): Map<string, number> {
  const out = new Map<string, number>();
  const pts = [...monthly].sort((a, b) => a.t - b.t);
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1].v, cur = pts[i].v;
    if (prev > 0 && isFinite(cur)) out.set(pts[i].ym, cur / prev - 1);
  }
  return out;
}

function ymToTs(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, 28) / 1000);
}
function maxDrawdown(eq: number[]): number | null {
  if (eq.length < 2) return null;
  let peak = eq[0], mdd = 0;
  for (const v of eq) { if (v > peak) peak = v; const dd = peak > 0 ? v / peak - 1 : 0; if (dd < mdd) mdd = dd; }
  return mdd;
}
function cagrOf(total: number | null, years: number): number | null {
  if (total == null || total <= -1 || years <= 0) return null;
  return Math.pow(1 + total, 1 / years) - 1;
}
function std(a: number[]): number | null {
  if (a.length < 2) return null;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

export function combinePortfolio(inputs: CombineInput[], benchmarkMonthly: MonthPoint[] | null): CombinedResult | null {
  const sel = inputs.filter(i => i.monthly.length >= 2 && i.weight > 0);
  if (!sel.length) return null;
  const retMaps = sel.map(s => ({ w: s.weight, r: monthlyReturns(s.monthly) }));
  const totalW = retMaps.reduce((s, x) => s + x.w, 0) || 1;

  // общие месяцы — пересечение (где доходность есть у всех выбранных)
  let common: string[] = [...retMaps[0].r.keys()];
  for (let i = 1; i < retMaps.length; i++) { const keys = retMaps[i].r; common = common.filter(ym => keys.has(ym)); }
  common.sort();
  const empty: CombinedResult = { months: [], equity: [1], benchEquity: null, yearly: [], benchYearly: null, total: null, cagr: null, maxDD: null, stdYear: null, years: 0, bench: null };
  if (!common.length) return empty;

  const equity: number[] = [1];
  for (const ym of common) {
    let r = 0;
    for (const rm of retMaps) r += (rm.w / totalW) * (rm.r.get(ym) as number);
    equity.push(equity[equity.length - 1] * (1 + r));
  }

  let benchEquity: number[] | null = null;
  let benchYearly: YearMetric[] | null = null;
  let bench: CombinedResult['bench'] = null;
  if (benchmarkMonthly && benchmarkMonthly.length >= 2) {
    const br = monthlyReturns(benchmarkMonthly);
    benchEquity = [1];
    for (const ym of common) { const r = br.has(ym) ? (br.get(ym) as number) : 0; benchEquity.push(benchEquity[benchEquity.length - 1] * (1 + r)); }
    const bpts = common.map((ym, k) => ({ t: ymToTs(ym), v: (benchEquity as number[])[k + 1] }));
    bpts.unshift({ t: ymToTs(common[0]) - 1, v: 1 });
    benchYearly = computeYearly(bpts);
    const btotal = benchEquity[benchEquity.length - 1] - 1;
    bench = { total: btotal, cagr: cagrOf(btotal, common.length / 12), maxDD: maxDrawdown(benchEquity) };
  }

  const pts = common.map((ym, k) => ({ t: ymToTs(ym), v: equity[k + 1] }));
  pts.unshift({ t: ymToTs(common[0]) - 1, v: 1 });
  const yearly = computeYearly(pts);
  const total = equity[equity.length - 1] - 1;
  const years = common.length / 12;
  return {
    months: common, equity, benchEquity, yearly, benchYearly,
    total, cagr: cagrOf(total, years), maxDD: maxDrawdown(equity),
    stdYear: std(yearly.map(y => y.ret).filter((x): x is number => x != null)),
    years, bench,
  };
}
