import { describe, it, expect } from 'vitest';
import { computeBlockMetrics, averagePairwiseCorrelation, computeRegime } from './block-metrics';
import type { InstrumentMetrics } from './types';

function mk(p: Partial<InstrumentMetrics>): InstrumentMetrics {
  return {
    symbol: 'X', last: 100, asOf: '2025-01-01', returns: { 1: 0, 5: 0, 21: 0, 63: 0, 126: 0, 252: 0 },
    mtd: null, qtd: null, ytd: null, vol21: null, vol63: null, volRatio: null, z63: null,
    pct52w: null, aboveMA50: null, aboveMA200: null, excess63: null, spark: [], sparkT: [],
    ...p,
  };
}

describe('computeBlockMetrics', () => {
  it('breadth, advancers/decliners, best/worst', () => {
    const bm = computeBlockMetrics([
      mk({ symbol: 'A', aboveMA200: true, aboveMA50: true, returns: { 1: 1, 5: 0, 21: 0, 63: 10, 126: 0, 252: 0 } }),
      mk({ symbol: 'B', aboveMA200: true, aboveMA50: false, returns: { 1: -1, 5: 0, 21: 0, 63: -5, 126: 0, 252: 0 } }),
      mk({ symbol: 'C', aboveMA200: false, aboveMA50: false, returns: { 1: 2, 5: 0, 21: 0, 63: 3, 126: 0, 252: 0 } }),
    ]);
    expect(bm.breadthMA200).toBeCloseTo((2 / 3) * 100, 4);
    expect(bm.advancers).toBe(2);
    expect(bm.decliners).toBe(1);
    expect(bm.best?.symbol).toBe('A');
    expect(bm.worst?.symbol).toBe('B');
    expect(bm.composite).not.toBeNull();
  });
  it('null-устойчивость на пустых метриках', () => {
    const bm = computeBlockMetrics([null, null]);
    expect(bm.breadthMA200).toBeNull();
    expect(bm.advancers).toBe(0);
    expect(bm.best).toBeNull();
    expect(bm.agg.returns[63]).toBeNull();
    expect(bm.agg.ytd).toBeNull();
  });
  it('agg — equal-weight среднее доходностей членов (null игнорируются)', () => {
    const bm = computeBlockMetrics([
      mk({ symbol: 'A', returns: { 1: 2, 5: 0, 21: 0, 63: 10, 126: 0, 252: 0 }, ytd: 20 }),
      mk({ symbol: 'B', returns: { 1: 4, 5: 0, 21: 0, 63: null as any, 126: 0, 252: 0 }, ytd: null }),
    ]);
    expect(bm.agg.returns[1]).toBeCloseTo(3, 6); // (2+4)/2
    expect(bm.agg.returns[63]).toBeCloseTo(10, 6); // только A
    expect(bm.agg.ytd).toBeCloseTo(20, 6); // только A
  });
});

describe('averagePairwiseCorrelation', () => {
  it('идентичные ряды → ~1', () => {
    const a = Array.from({ length: 30 }, (_, i) => Math.sin(i));
    const c = averagePairwiseCorrelation([a, a, a]);
    expect(c).not.toBeNull();
    expect(c as number).toBeCloseTo(1, 5);
  });
  it('меньше двух валидных рядов → null', () => {
    expect(averagePairwiseCorrelation([[1, 2]])).toBeNull();
  });
});

describe('computeRegime', () => {
  it('высокая корреляция + низкая широта → risk-off', () => {
    const r = computeRegime({ avgCorr: 0.9, volRegime: 1.6, breadth: 20 });
    expect(r.label).toBe('risk-off');
    expect(r.score).toBeGreaterThan(60);
  });
  it('низкая корреляция + высокая широта → risk-on', () => {
    const r = computeRegime({ avgCorr: 0.3, volRegime: 0.7, breadth: 90 });
    expect(r.label).toBe('risk-on');
    expect(r.score).toBeLessThan(40);
  });
  it('нет данных → нейтрально 50', () => {
    const r = computeRegime({ avgCorr: null, volRegime: null, breadth: null });
    expect(r.score).toBe(50);
    expect(r.label).toBe('neutral');
  });
});
