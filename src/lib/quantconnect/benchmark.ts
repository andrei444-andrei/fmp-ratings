// Канонический бенчмарк — SPY (из FMP, не из настроек бектеста), чтобы было явно
// и одинаково для всех стратегий. Дневные цены тянутся/кэшируются через research/prices,
// затем считаются годовые метрики и месячный ряд. Кэш — на сутки (ключ с датой).

import { getPrices } from '@/lib/research/prices';
import { computeYearly, monthlyEquity } from './metrics';
import { qcCacheGet, qcCacheSet } from './cache';
import type { MonthPoint, QcSeriesPoint, YearMetric } from './types';

export type BenchmarkData = { name: string; yearly: YearMetric[]; monthly: MonthPoint[] };

export async function getSpyBenchmark(force = false): Promise<BenchmarkData | null> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `bench|SPY|${today}`;
  if (!force) {
    const cached = await qcCacheGet<BenchmarkData>(key);
    if (cached && cached.monthly) return cached;
  }
  try {
    const rows = await getPrices('SPY', '2000-01-01', today);
    const points: QcSeriesPoint[] = rows
      .map(r => ({ t: Math.floor(Date.parse(r.date + 'T00:00:00Z') / 1000), v: r.close }))
      .filter(p => isFinite(p.t) && isFinite(p.v) && p.v > 0);
    if (points.length < 30) return null;
    const data: BenchmarkData = { name: 'SPY', yearly: computeYearly(points), monthly: monthlyEquity(points) };
    if (data.yearly.length) await qcCacheSet(key, data);
    return data;
  } catch {
    return null;
  }
}
