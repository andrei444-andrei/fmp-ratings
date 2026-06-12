// Расчёт годовых метрик из кривой капитала бектеста (client-safe, чистые функции).
// Для каждого календарного года: доходность за год, макс. просадка за год,
// накопительная доходность с начала бектеста.

import type { MonthPoint, QcSeriesPoint, YearMetric } from './types';

// QC отдаёт время в секундах; на всякий случай поддержим и миллисекунды.
function toMs(t: number): number {
  return t > 1e12 ? t : t * 1000;
}

// Даунсэмпл дневной кривой капитала до значений на конец каждого месяца.
export function monthlyEquity(points: QcSeriesPoint[]): MonthPoint[] {
  const pts = points
    .map(p => ({ t: toMs(p.t), v: p.v }))
    .filter(p => isFinite(p.v) && p.v > 0 && isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const byMonth = new Map<string, { t: number; v: number }>();
  for (const p of pts) {
    const d = new Date(p.t);
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth.set(ym, p); // последняя точка месяца (идём по возрастанию) = конец месяца
  }
  return [...byMonth.entries()]
    .map(([ym, p]) => ({ ym, t: Math.floor(p.t / 1000), v: p.v }))
    .sort((a, b) => a.t - b.t);
}

export function computeYearly(points: QcSeriesPoint[]): YearMetric[] {
  const pts = points
    .map(p => ({ t: toMs(p.t), v: p.v }))
    .filter(p => isFinite(p.v) && p.v > 0 && isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return [];

  const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
  const first = pts[0].v; // капитал на старте бектеста (инцепция)

  const byYear = new Map<number, { t: number; v: number }[]>();
  for (const p of pts) {
    const y = yearOf(p.t);
    let bucket = byYear.get(y);
    if (!bucket) { bucket = []; byYear.set(y, bucket); }
    bucket.push(p);
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const out: YearMetric[] = [];
  let prevEnd = first; // база первого года = стартовый капитал

  for (let i = 0; i < years.length; i++) {
    const y = years[i];
    const yp = byYear.get(y)!;
    const base = i === 0 ? first : prevEnd;
    const end = yp[yp.length - 1].v;

    const ret = base > 0 ? end / base - 1 : null;

    // Внутригодовая макс. просадка: пик стартует с базы (конец прошлого года).
    let peak = base;
    let maxDD = 0;
    for (const p of yp) {
      if (p.v > peak) peak = p.v;
      const dd = peak > 0 ? p.v / peak - 1 : 0;
      if (dd < maxDD) maxDD = dd;
    }

    const cumulative = first > 0 ? end / first - 1 : null;
    out.push({ year: y, ret, maxDD, cumulative });
    prevEnd = end;
  }
  return out;
}
