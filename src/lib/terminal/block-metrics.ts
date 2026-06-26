// Метрики уровня БЛОКА и глобального режима рынка. Считаются на сервере по матрице
// членов блока (см. docs §4). Для малых корзин breadth вырождается — отдаём
// equal-weight доходность + лучший/худший компонент.
import { correlation } from './metrics';
import type { BlockMetrics, InstrumentMetrics, MarketRegime } from './types';

function pctTrue(flags: (boolean | null)[]): number | null {
  const known = flags.filter((f): f is boolean => f != null);
  if (!known.length) return null;
  return (known.filter(Boolean).length / known.length) * 100;
}

/** Агрегаты блока из метрик его инструментов (optional-бумаги без истории игнорируются). */
export function computeBlockMetrics(metrics: (InstrumentMetrics | null)[]): BlockMetrics {
  const ok = metrics.filter((m): m is InstrumentMetrics => m != null);
  const breadthMA50 = pctTrue(ok.map((m) => m.aboveMA50));
  const breadthMA200 = pctTrue(ok.map((m) => m.aboveMA200));

  let advancers = 0;
  let decliners = 0;
  for (const m of ok) {
    const r1 = m.returns[1];
    if (r1 == null) continue;
    if (r1 > 0) advancers++;
    else if (r1 < 0) decliners++;
  }

  // Composite 0..100: широта по MA + перевес растущих.
  const advShare = advancers + decliners > 0 ? (advancers / (advancers + decliners)) * 100 : null;
  const parts = [breadthMA200, breadthMA50, advShare].filter((x): x is number => x != null);
  const composite = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;

  let best: BlockMetrics['best'] = null;
  let worst: BlockMetrics['worst'] = null;
  for (const m of ok) {
    const r = m.returns[63];
    if (r == null) continue;
    if (!best || r > best.ret63) best = { symbol: m.symbol, ret63: r };
    if (!worst || r < worst.ret63) worst = { symbol: m.symbol, ret63: r };
  }

  return { breadthMA50, breadthMA200, advancers, decliners, composite, avgCorr: null, best, worst };
}

/** Средняя попарная корреляция набора рядов дневных лог-доходностей (выровнены по хвосту). */
export function averagePairwiseCorrelation(returnsList: number[][], lookback = 63): number | null {
  const series = returnsList.filter((r) => r.length >= 10).map((r) => r.slice(-lookback));
  if (series.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const c = correlation(series[i], series[j]);
      if (c != null) {
        sum += c;
        n++;
      }
    }
  }
  return n ? sum / n : null;
}

/** Глобальный режим: композит из vol-режима бенчмарка, средней корреляции и широты.
 *  score 0 (risk-on) .. 100 (risk-off). */
export function computeRegime(opts: {
  avgCorr: number | null;
  volRegime: number | null; // vol21/vol252 бенчмарка
  breadth: number | null; // % вселенной выше MA200
}): MarketRegime {
  const { avgCorr, volRegime, breadth } = opts;
  const parts: number[] = [];
  // высокая корреляция → risk-off
  if (avgCorr != null) parts.push(clamp01((avgCorr - 0.3) / 0.6) * 100);
  // волатильность выше «нормы» (ratio>1) → risk-off
  if (volRegime != null) parts.push(clamp01((volRegime - 0.8) / 0.8) * 100);
  // низкая широта → risk-off
  if (breadth != null) parts.push(100 - breadth);
  const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 50;
  const label: MarketRegime['label'] = score < 40 ? 'risk-on' : score > 60 ? 'risk-off' : 'neutral';
  return { score: Math.round(score), avgCorr, volRegime, breadth, label };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
