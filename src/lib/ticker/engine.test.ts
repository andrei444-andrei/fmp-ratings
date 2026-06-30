import { describe, it, expect } from 'vitest';
import {
  computeFactors, forwardReturns, baselineStats, binStats, makeEdges, mergeMinN, binIndexVal, kmeans1d,
  type BinCfg,
} from './engine';

// Детерминированный синтетический ряд для тестов движка.
function genSeries(n = 3000, seed = 7): number[] {
  let s = seed, v = 50;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const r = (s / 0x7fffffff - 0.49) * 4;
    v = Math.max(1, v * (1 + r / 100));
    out.push(v);
  }
  return out;
}
const cfg = (over: Partial<BinCfg> = {}): BinCfg => ({ mode: 'auto', k: 5, minN: 30, manual: [], ...over });

describe('ticker engine — факторы', () => {
  const c = genSeries();
  const spy = genSeries(c.length, 99);
  const f = computeFactors(c, spy);

  it('distAth всегда ≤ 0 (цена не выше своего исторического максимума)', () => {
    expect(f.distAth.every((x) => x == null || x <= 1e-9)).toBe(true);
  });
  it('sma200 неопределена до прогрева и определена после', () => {
    expect(f.sma200[100]).toBeNull();
    expect(typeof f.sma200[500]).toBe('number');
  });
  it('vol21 неотрицательна', () => {
    expect(f.vol21.every((x) => x == null || x >= 0)).toBe(true);
  });
  it('forwardReturns длиной с ряд, последние H — null', () => {
    const fr = forwardReturns(c, 5);
    expect(fr.length).toBe(c.length);
    expect(fr[c.length - 1]).toBeNull();
    expect(typeof fr[0]).toBe('number');
  });
});

describe('ticker engine — биннинг', () => {
  const vals = genSeries(2000).map((x) => x / 100 - 0.5); // разброс значений

  it('makeEdges возрастающие во всех режимах', () => {
    for (const mode of ['auto', 'quantile', 'equal', 'manual'] as const) {
      const E = makeEdges(vals, cfg({ mode, manual: [-0.2, 0, 0.2] }));
      for (let i = 1; i < E.length; i++) expect(E[i]).toBeGreaterThan(E[i - 1]);
    }
  });
  it('kmeans1d даёт ≤ k+1 границ и покрывает диапазон', () => {
    const E = kmeans1d(vals, 5);
    expect(E.length).toBeLessThanOrEqual(6);
    expect(E[0]).toBeLessThanOrEqual(Math.min(...vals));
    expect(E[E.length - 1]).toBeGreaterThanOrEqual(Math.max(...vals));
  });
  it('mergeMinN убирает бины ниже минимума наблюдений', () => {
    const E = makeEdges(vals, cfg({ mode: 'equal', k: 8 }));
    const merged = mergeMinN(E, vals, 200);
    const cnt = new Array(merged.length - 1).fill(0);
    for (const v of vals) cnt[binIndexVal(merged, v)]++;
    if (merged.length - 1 > 1) expect(cnt.every((c) => c >= 200)).toBe(true);
  });
});

describe('ticker engine — binStats покрытие и статистика', () => {
  const c = genSeries(4000);
  const spy = genSeries(c.length, 5);
  const f = computeFactors(c, spy);
  const years = c.map((_, i) => 2005 + Math.floor(i / 252));
  const H = 21;
  const fr = forwardReturns(c, H);
  const base = baselineStats(fr);

  for (const mode of ['auto', 'quantile', 'equal', 'manual'] as const) {
    it(`режим ${mode}: точное покрытие, валидный curBin, без NaN`, () => {
      const res = binStats(f.smaDist200, fr, years, cfg({ mode, manual: [-0.1, -0.03, 0.03, 0.1] }), 'signed', base.mean, H);
      // покрытие: сумма n по бинам = число валидных (фактор+форвард) наблюдений после прогрева
      let tot = 0;
      for (let i = 200; i < f.smaDist200.length; i++) if (f.smaDist200[i] != null && fr[i] != null) tot++;
      const sumN = res.bins.reduce((s, b) => s + b.stat.n, 0);
      expect(sumN).toBe(tot);
      expect(res.curBin).toBeGreaterThanOrEqual(0);
      expect(res.curBin).toBeLessThan(res.bins.length);
      for (const b of res.bins) {
        for (const x of [b.stat.edge, b.stat.mean, b.stat.ciLo, b.stat.ciHi, b.stat.hit]) expect(Number.isFinite(x)).toBe(true);
        expect(b.stat.neff).toBeLessThanOrEqual(b.stat.n);
      }
    });
  }

  it('edge = условное среднее − baseline', () => {
    const res = binStats(f.smaDist200, fr, years, cfg({ mode: 'quantile' }), 'signed', base.mean, H);
    for (const b of res.bins) expect(Math.abs(b.stat.edge - (b.stat.mean - base.mean))).toBeLessThan(1e-9);
  });
});
