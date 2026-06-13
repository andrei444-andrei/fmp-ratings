// Канонический бенчмарк — SPY как TOTAL RETURN (с реинвестом дивидендов), из FMP.
// adjClose из dividend-adjusted эндпоинта учитывает дивиденды → честное сравнение с
// equity стратегий QuantConnect (которые тоже получают дивиденды). Фолбэк — ценовой
// ряд (без дивидендов), если adjusted-эндпоинт недоступен. Кэш — на сутки.

import { getPrices } from '@/lib/research/prices';
import { fmpHistoricalPriceEodDividendAdjusted } from '@/lib/fmp';
import { computeYearly, dailySeries } from './metrics';
import { qcCacheGet, qcCacheSet, qcCacheDeleteLike } from './cache';
import type { DayPoint, QcSeriesPoint, YearMetric } from './types';

export type BenchmarkData = { name: string; yearly: YearMetric[]; daily: DayPoint[]; day?: string };

async function spyPoints(today: string): Promise<QcSeriesPoint[]> {
  // 1) total return (с дивидендами) — adjClose
  try {
    const data: any = await fmpHistoricalPriceEodDividendAdjusted('SPY', '2000-01-01', today);
    const arr: any[] = Array.isArray(data) ? data : data?.historical ?? [];
    const pts: QcSeriesPoint[] = arr
      .map((d: any) => ({
        t: Math.floor(Date.parse(String(d.date) + 'T00:00:00Z') / 1000),
        v: Number(d.adjClose ?? d.adjustedClose ?? d.close ?? d.price),
      }))
      .filter((p: QcSeriesPoint) => isFinite(p.t) && isFinite(p.v) && p.v > 0);
    if (pts.length >= 30) return pts;
  } catch { /* фолбэк ниже */ }

  // 2) фолбэк: ценовой ряд (без дивидендов)
  const rows = await getPrices('SPY', '2000-01-01', today);
  return rows
    .map(r => ({ t: Math.floor(Date.parse(r.date + 'T00:00:00Z') / 1000), v: r.close }))
    .filter(p => isFinite(p.t) && isFinite(p.v) && p.v > 0);
}

export async function getSpyBenchmark(force = false): Promise<BenchmarkData | null> {
  const today = new Date().toISOString().slice(0, 10);
  // Стабильный ключ (без даты) — одна строка, перезаписывается; свежесть — по полю day.
  // Раньше дата была в ключе → каждый день копилась новая большая строка (утечка записи/места).
  const key = 'bench|SPY|v4';
  if (!force) {
    const cached = await qcCacheGet<BenchmarkData>(key);
    if (cached && cached.daily && cached.day === today) return cached;
  }
  try {
    const points = await spyPoints(today);
    if (points.length < 30) return null;
    const data: BenchmarkData = { name: 'SPY', day: today, yearly: computeYearly(points), daily: dailySeries(points) };
    if (data.yearly.length) {
      await qcCacheSet(key, data);
      // подчищаем старые date-keyed строки (раньше копились по дню)
      await qcCacheDeleteLike('bench|SPY|v3|%');
      await qcCacheDeleteLike('bench|SPY|2%');
    }
    return data;
  } catch {
    return null;
  }
}
