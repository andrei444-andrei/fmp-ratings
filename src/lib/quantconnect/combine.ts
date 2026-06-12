// Объединение нескольких стратегий в портфель: помесячный ребаланс к целевым весам,
// но эквити отслеживается ПО ДНЯМ — поэтому просадка реальная (дневная), а не месячная.
// Client-safe: чистые функции над дневными рядами капитала.

import { computeYearly } from './metrics';
import type { DayPoint, YearMetric } from './types';

export type CombineInput = { id: number; daily: DayPoint[]; weight: number };

export type CombinedResult = {
  dates: string[];                // общие торговые дни (где у всех выбранных есть данные)
  equity: number[];               // дневная кривая портфеля, старт = 1
  benchEquity: number[] | null;   // бенчмарк на тех же днях (старт = 1)
  yearly: YearMetric[];           // годовые метрики из дневной кривой
  benchYearly: YearMetric[] | null;
  total: number | null;
  cagr: number | null;
  maxDD: number | null;           // РЕАЛЬНАЯ дневная макс. просадка
  stdYear: number | null;
  years: number;
  bench: { total: number | null; cagr: number | null; maxDD: number | null } | null;
};

const dts = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

function maxDrawdown(eq: number[]): number | null {
  const v = eq.filter(x => isFinite(x) && x > 0);
  if (v.length < 2) return null;
  let peak = v[0], mdd = 0;
  for (const x of v) { if (x > peak) peak = x; const dd = peak > 0 ? x / peak - 1 : 0; if (dd < mdd) mdd = dd; }
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

export function combinePortfolio(inputs: CombineInput[], benchmarkDaily: DayPoint[] | null): CombinedResult | null {
  const sel = inputs.filter(i => i.daily.length >= 2 && i.weight > 0);
  if (!sel.length) return null;

  const maps = sel.map(s => ({ w: s.weight, m: new Map(s.daily.map(p => [p.d, p.v])) }));
  const totalW = maps.reduce((s, x) => s + x.w, 0) || 1;
  const wn = maps.map(x => x.w / totalW);

  // общие торговые дни — пересечение
  let dates = sel[0].daily.map(p => p.d);
  for (let i = 1; i < maps.length; i++) { const mm = maps[i].m; dates = dates.filter(d => mm.has(d)); }
  dates.sort();
  const empty: CombinedResult = { dates: [], equity: [1], benchEquity: null, yearly: [], benchYearly: null, total: null, cagr: null, maxDD: null, stdYear: null, years: 0, bench: null };
  if (dates.length < 2) return empty;

  // помесячный ребаланс к весам, но капитал каждой части растёт по своим дневным доходностям
  const alloc = wn.slice(); // V0 = 1
  const equity: number[] = [1];
  let prevMonth = dates[0].slice(0, 7);
  for (let k = 1; k < dates.length; k++) {
    const d = dates[k], pd = dates[k - 1];
    for (let i = 0; i < maps.length; i++) {
      const cur = maps[i].m.get(d) as number, prev = maps[i].m.get(pd) as number;
      alloc[i] *= prev > 0 ? cur / prev : 1;
    }
    const V = alloc.reduce((s, x) => s + x, 0);
    equity.push(V);
    const mo = d.slice(0, 7);
    if (mo !== prevMonth) { for (let i = 0; i < maps.length; i++) alloc[i] = V * wn[i]; prevMonth = mo; }
  }

  const years = (dts(dates[dates.length - 1]) - dts(dates[0])) / (365.25 * 86400);
  const pts = dates.map((d, k) => ({ t: dts(d), v: equity[k] }));
  const yearly = computeYearly(pts);
  const total = equity[equity.length - 1] - 1;

  // бенчмарк на тех же днях (carry-forward значения)
  let benchEquity: number[] | null = null;
  let benchYearly: YearMetric[] | null = null;
  let bench: CombinedResult['bench'] = null;
  if (benchmarkDaily && benchmarkDaily.length >= 2) {
    const bm = new Map(benchmarkDaily.map(p => [p.d, p.v]));
    const arr: number[] = [];
    let last: number | null = null, base: number | null = null;
    for (const d of dates) {
      if (bm.has(d)) last = bm.get(d)!;
      if (last == null) { arr.push(NaN); continue; }
      if (base == null) base = last;
      arr.push(last / base);
    }
    benchEquity = arr;
    const bpts = dates.map((d, k) => ({ t: dts(d), v: arr[k] })).filter(p => isFinite(p.v) && p.v > 0);
    benchYearly = computeYearly(bpts);
    const valid = arr.filter(x => isFinite(x) && x > 0);
    const bt = valid.length ? valid[valid.length - 1] - 1 : null;
    bench = { total: bt, cagr: cagrOf(bt, years), maxDD: maxDrawdown(valid) };
  }

  return {
    dates, equity, benchEquity, yearly, benchYearly,
    total, cagr: cagrOf(total, years), maxDD: maxDrawdown(equity),
    stdYear: std(yearly.map(y => y.ret).filter((x): x is number => x != null)),
    years, bench,
  };
}
