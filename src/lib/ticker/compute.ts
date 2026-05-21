// Чистые вычисления для раздела /ticker: выравнивание ценовых рядов,
// доходность, CAGR, max drawdown, волатильность, даунсэмплинг.
// Без серверных зависимостей — переиспользуется и на клиенте при нужде.

import type { ChartPayload, TickerKpis, RangeKey } from './types';

export type PriceMap = Record<string, number>;

// Дата старта окна для выбранного диапазона (YYYY-MM-DD).
export function rangeFrom(range: RangeKey, today = new Date()): string {
  if (range === 'max') return '1900-01-01';
  if (range === '2010') return '2010-01-01';
  const years = range === '1y' ? 1 : range === '3y' ? 3 : range === '5y' ? 5 : 10;
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// Выравнивает ряд тикера и бенчмарка на дни торгов тикера >= from.
// Бенчмарк forward-fill'ится по последней известной цене (на случай редких пропусков).
export function alignSeries(
  sym: PriceMap,
  bench: PriceMap,
  from: string,
): { dates: string[]; sym: number[]; bench: number[] } {
  const dates = Object.keys(sym).filter(d => d >= from).sort();
  const benchDates = Object.keys(bench).sort();
  const symOut: number[] = [];
  const benchOut: number[] = [];
  let bi = 0;
  let lastBench = NaN;
  for (const d of dates) {
    while (bi < benchDates.length && benchDates[bi] <= d) {
      lastBench = bench[benchDates[bi]];
      bi++;
    }
    symOut.push(sym[d]);
    benchOut.push(lastBench);
  }
  return { dates, sym: symOut, bench: benchOut };
}

function growth(values: number[]): number[] {
  const base = values.find(v => isFinite(v) && v > 0);
  if (base == null) return values.map(() => NaN);
  return values.map(v => (isFinite(v) && v > 0 ? v / base : NaN));
}

function pctFromGrowth(g: number[]): number[] {
  return g.map(v => (isFinite(v) ? (v - 1) * 100 : NaN));
}

function maxDrawdownPct(values: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of values) {
    if (!isFinite(v)) continue;
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v / peak - 1) * 100;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd;
}

function annualizedVolPct(values: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (isFinite(a) && isFinite(b) && a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function cagrPct(values: number[], dates: string[]): number {
  const first = values.find(v => isFinite(v) && v > 0);
  let last = NaN;
  for (let i = values.length - 1; i >= 0; i--) {
    if (isFinite(values[i]) && values[i] > 0) { last = values[i]; break; }
  }
  if (first == null || !isFinite(last)) return 0;
  const d0 = new Date(dates[0]).getTime();
  const d1 = new Date(dates[dates.length - 1]).getTime();
  const years = (d1 - d0) / (365.25 * 24 * 3600 * 1000);
  if (years < 0.08) return (last / first - 1) * 100; // < ~1 мес — просто доходность
  return ((last / first) ** (1 / years) - 1) * 100;
}

// Лучший / худший торговый день по дневной доходности.
function extremes(values: number[], dates: string[]) {
  let best: { date: string; pct: number } | null = null;
  let worst: { date: string; pct: number } | null = null;
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (!isFinite(a) || !isFinite(b) || a <= 0) continue;
    const pct = (b / a - 1) * 100;
    if (!best || pct > best.pct) best = { date: dates[i], pct };
    if (!worst || pct < worst.pct) worst = { date: dates[i], pct };
  }
  return { best, worst };
}

// Прореживание ряда до <= maxPoints точек (равномерно, всегда с последней точкой).
function downsampleIdx(n: number, maxPoints: number): number[] {
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (maxPoints - 1);
  const idx: number[] = [];
  for (let k = 0; k < maxPoints; k++) idx.push(Math.round(k * step));
  idx[idx.length - 1] = n - 1;
  return Array.from(new Set(idx));
}

export function buildChartAndKpis(
  symPrices: PriceMap,
  benchPrices: PriceMap,
  from: string,
  maxPoints = 600,
): { chart: ChartPayload; kpis: TickerKpis; window: { from: string; to: string } } | null {
  const aligned = alignSeries(symPrices, benchPrices, from);
  if (aligned.dates.length < 2) return null;

  const symGrowthFull = growth(aligned.sym);
  const benchGrowthFull = growth(aligned.bench);

  const kpis: TickerKpis = {
    totalReturnPct: pctFromGrowth(symGrowthFull).filter(isFinite).slice(-1)[0] ?? 0,
    benchReturnPct: pctFromGrowth(benchGrowthFull).filter(isFinite).slice(-1)[0] ?? 0,
    alphaPct: 0,
    cagrPct: cagrPct(aligned.sym, aligned.dates),
    benchCagrPct: cagrPct(aligned.bench, aligned.dates),
    maxDrawdownPct: maxDrawdownPct(aligned.sym),
    volPct: annualizedVolPct(aligned.sym),
    ...extremes(aligned.sym, aligned.dates),
  };
  kpis.alphaPct = kpis.totalReturnPct - kpis.benchReturnPct;

  const idx = downsampleIdx(aligned.dates.length, maxPoints);
  const symGrowth = idx.map(i => symGrowthFull[i]);
  const benchGrowth = idx.map(i => benchGrowthFull[i]);
  const chart: ChartPayload = {
    dates: idx.map(i => aligned.dates[i]),
    symbolPct: pctFromGrowth(symGrowth),
    benchmarkPct: pctFromGrowth(benchGrowth),
    symbolGrowth: symGrowth,
    benchmarkGrowth: benchGrowth,
  };

  return {
    chart,
    kpis,
    window: { from: aligned.dates[0], to: aligned.dates[aligned.dates.length - 1] },
  };
}
