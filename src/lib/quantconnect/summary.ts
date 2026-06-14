// Сводка по одной стратегии (client-safe): из дневного ряда капитала считаем
// CAGR/итог, реальную дневную просадку, Sharpe/Sortino/Calmar (по месячным доходностям),
// помесячный heatmap и годовые итоги; плюс выровненный бенчмарк для графика.

import type { DayPoint } from './types';

export type StrategySummary = {
  obsDays: number;
  years: number;
  cagr: number | null; total: number | null;
  maxDD: number | null; maxDDPeak: string | null; maxDDTrough: string | null;
  sharpe: number | null; sortino: number | null; calmar: number | null; volAnn: number | null;
  posMonths: number | null;
  bestMonth: { ym: string; r: number } | null; worstMonth: { ym: string; r: number } | null;
  bestYear: { year: number; r: number } | null; worstYear: { year: number; r: number } | null;
  dates: string[]; equity: number[]; benchEquity: number[] | null;
  monthly: Record<number, Record<number, number>>; // год -> месяц(1..12) -> доходность
  yearlyTotals: Record<number, number>;
  // помесячные/годовые доходности бенчмарка — для таблицы Δ к SPY (превышение/занижение)
  monthlyBench: Record<number, Record<number, number>> | null;
  yearlyBenchTotals: Record<number, number> | null;
};

const dts = (d: string) => Date.parse(d + 'T00:00:00Z');

function monthEnd(daily: DayPoint[]): { ym: string; year: number; month: number; v: number }[] {
  const m = new Map<string, { v: number; year: number; month: number }>();
  for (const p of daily) {
    const ym = p.d.slice(0, 7);
    m.set(ym, { v: p.v, year: Number(p.d.slice(0, 4)), month: Number(p.d.slice(5, 7)) });
  }
  return [...m.entries()].map(([ym, x]) => ({ ym, year: x.year, month: x.month, v: x.v })).sort((a, b) => (a.ym < b.ym ? -1 : 1));
}
function mean(a: number[]) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function std(a: number[]) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }

export function computeSummary(dailyIn: DayPoint[], benchmarkDaily: DayPoint[] | null): StrategySummary | null {
  const daily = [...dailyIn].filter(p => isFinite(p.v) && p.v > 0).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (daily.length < 20) return null;

  const dates = daily.map(p => p.d);
  const v0 = daily[0].v;
  const equity = daily.map(p => p.v / v0);

  // реальная дневная просадка + даты
  let peakV = equity[0], peakD = dates[0], mdd = 0, mPeak = dates[0], mTrough = dates[0];
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peakV) { peakV = equity[i]; peakD = dates[i]; }
    const dd = peakV > 0 ? equity[i] / peakV - 1 : 0;
    if (dd < mdd) { mdd = dd; mPeak = peakD; mTrough = dates[i]; }
  }

  const years = (dts(dates[dates.length - 1]) - dts(dates[0])) / (365.25 * 86400000);
  const total = equity[equity.length - 1] - 1;
  const cagr = years > 0 && total > -1 ? Math.pow(1 + total, 1 / years) - 1 : null;

  // помесячные доходности
  const me = monthEnd(daily);
  const monthly: Record<number, Record<number, number>> = {};
  const monthRets: { ym: string; year: number; r: number }[] = [];
  for (let i = 1; i < me.length; i++) {
    const r = me[i - 1].v > 0 ? me[i].v / me[i - 1].v - 1 : 0;
    if (!isFinite(r)) continue;
    (monthly[me[i].year] ??= {})[me[i].month] = r;
    monthRets.push({ ym: me[i].ym, year: me[i].year, r });
  }
  const rs = monthRets.map(x => x.r);
  const ann = 12;
  const sd = std(rs);
  const sharpe = sd > 0 ? (mean(rs) / sd) * Math.sqrt(ann) : null;
  const downs = rs.map(r => Math.min(r, 0));
  const dd = Math.sqrt(mean(downs.map(x => x * x)));
  const sortino = dd > 0 ? (mean(rs) / dd) * Math.sqrt(ann) : null;
  const volAnn = sd > 0 ? sd * Math.sqrt(ann) : null;
  const calmar = cagr != null && mdd < 0 ? cagr / Math.abs(mdd) : null;
  const posMonths = rs.length ? rs.filter(r => r > 0).length / rs.length : null;

  let bestMonth: { ym: string; r: number } | null = null, worstMonth: { ym: string; r: number } | null = null;
  for (const x of monthRets) {
    if (!bestMonth || x.r > bestMonth.r) bestMonth = { ym: x.ym, r: x.r };
    if (!worstMonth || x.r < worstMonth.r) worstMonth = { ym: x.ym, r: x.r };
  }

  // годовые итоги (компаундинг месяцев в году)
  const yearlyTotals: Record<number, number> = {};
  for (const [y, months] of Object.entries(monthly)) {
    let acc = 1;
    for (const m of Object.values(months)) acc *= 1 + m;
    yearlyTotals[Number(y)] = acc - 1;
  }
  let bestYear: { year: number; r: number } | null = null, worstYear: { year: number; r: number } | null = null;
  for (const [y, r] of Object.entries(yearlyTotals)) {
    const yr = { year: Number(y), r };
    if (!bestYear || r > bestYear.r) bestYear = yr;
    if (!worstYear || r < worstYear.r) worstYear = yr;
  }

  // бенчмарк по тем же дням (carry-forward), нормированный
  let benchEquity: number[] | null = null;
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
  }

  // помесячные/годовые доходности бенчмарка (по его собственным концам месяцев) —
  // нужны для таблицы Δ к SPY (помесячное превышение/занижение доходности).
  let monthlyBench: Record<number, Record<number, number>> | null = null;
  let yearlyBenchTotals: Record<number, number> | null = null;
  if (benchmarkDaily && benchmarkDaily.length >= 20) {
    const bdaily = [...benchmarkDaily].filter(p => isFinite(p.v) && p.v > 0).sort((a, b) => (a.d < b.d ? -1 : 1));
    const bme = monthEnd(bdaily);
    const mb: Record<number, Record<number, number>> = {};
    for (let i = 1; i < bme.length; i++) {
      const r = bme[i - 1].v > 0 ? bme[i].v / bme[i - 1].v - 1 : 0;
      if (!isFinite(r)) continue;
      (mb[bme[i].year] ??= {})[bme[i].month] = r;
    }
    monthlyBench = mb;
    const yb: Record<number, number> = {};
    for (const [y, months] of Object.entries(mb)) {
      let acc = 1;
      for (const m of Object.values(months)) acc *= 1 + m;
      yb[Number(y)] = acc - 1;
    }
    yearlyBenchTotals = yb;
  }

  return {
    obsDays: daily.length, years,
    cagr, total, maxDD: mdd < 0 ? mdd : null, maxDDPeak: mdd < 0 ? mPeak : null, maxDDTrough: mdd < 0 ? mTrough : null,
    sharpe, sortino, calmar, volAnn, posMonths, bestMonth, worstMonth, bestYear, worstYear,
    dates, equity, benchEquity, monthly, yearlyTotals, monthlyBench, yearlyBenchTotals,
  };
}
