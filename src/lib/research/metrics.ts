import type { PriceRow } from './prices';

/** Детерминированный синтетический ряд (без ключей/FMP) — для демо и стабильных e2e. */
export function syntheticSeries(symbol: string, n = 180): PriceRow[] {
  let seed = 7;
  for (const c of symbol) seed = (seed * 31 + c.charCodeAt(0)) % 2147483647;
  let v = 80 + (seed % 120);
  const rows: PriceRow[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const r = (seed / 0x7fffffff - 0.47) * 2.4; // лёгкий положительный дрейф
    v = Math.max(1, v * (1 + r / 100));
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    rows.push({ date: d.toISOString().slice(0, 10), close: Math.round(v * 100) / 100 });
  }
  return rows;
}

export type TrendMetrics = { first: number; last: number; ret: number; maxDd: number; ma50: number };

export function computeMetrics(series: PriceRow[]): TrendMetrics {
  const closes = series.map((s) => s.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const ret = ((last - first) / first) * 100;
  let peak = -Infinity;
  let maxDd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDd = Math.min(maxDd, ((c - peak) / peak) * 100);
  }
  const tail = closes.slice(-50);
  const ma50 = tail.reduce((a, b) => a + b, 0) / tail.length;
  return { first, last, ret, maxDd, ma50 };
}
