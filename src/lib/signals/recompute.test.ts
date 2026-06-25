import { describe, it, expect } from 'vitest';
import { recomputeCells, type Panel, type CellDef } from './recompute';

// Эталон: тот же расчёт «в лоб», независимой реализацией — сверяем с recomputeCells.
function ref(obs: number[][], dates: string[], pred: (f: number, v: number) => boolean, yf: number, yt: number) {
  const byDate = new Map<number, number[]>();
  let n = 0, pos = 0;
  for (const [di, f, v, r] of obs) {
    if (+dates[di].slice(0, 4) < yf || +dates[di].slice(0, 4) > yt) continue;
    if (!pred(f, v)) continue;
    (byDate.get(di) || byDate.set(di, []).get(di)!).push(r);
    n++; if (r > 0) pos++;
  }
  const P = byDate.size;
  if (n < 10 || P < 5) return null;
  const means = [...byDate.values()].map((a) => a.reduce((x, y) => x + y, 0) / a.length);
  const m = means.reduce((a, b) => a + b, 0) / P;
  const v = P > 1 ? means.reduce((a, b) => a + (b - m) ** 2, 0) / (P - 1) : 0;
  const t = v > 0 ? m / Math.sqrt(v / P) : 0;
  return { mean: m, t, hit: (pos / n) * 100, n, periods: P };
}

// Детерминированная панель: 12 дат × 6 «тикеров», f и v варьируются.
function makePanel(): { panel: Panel; obs: number[][] } {
  const dates: string[] = [];
  for (let y = 2020; y <= 2023; y++) for (let mo = 1; mo <= 3; mo++) dates.push(`${y}-0${mo}-15`);
  const obs: number[][] = [];
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let di = 0; di < dates.length; di++) {
    for (let k = 0; k < 6; k++) {
      const f = (rnd() - 0.5) * 40; // фактор -20..20
      const v = rnd() * 60; // фильтр-значение 0..60 (напр. вол %)
      const r = (rnd() - 0.45) * 8; // форвард
      obs.push([di, Math.round(f * 1000) / 1000, Math.round(v * 1000) / 1000, Math.round(r * 1000) / 1000]);
    }
  }
  return { panel: { dates, params: { '21': obs } }, obs };
}

describe('recomputeCells', () => {
  const { panel, obs } = makePanel();
  const grid: CellDef[] = [
    { param: 21, col: '≥0', region: { side: 'high', threshold: 0 } },
    { param: 21, col: '≤0', region: { side: 'low', threshold: 0 } },
  ];

  it('паритет с эталоном: фильтр выкл, полное окно лет', () => {
    const lf = { enabled: false, side: 'high' as const, threshold: 0, op: 'exclude' as const };
    const got = recomputeCells(grid, panel, 'cumulative', 1900, 2100, lf);
    const r1 = ref(obs, panel.dates, (f) => f >= 0, 1900, 2100);
    const g1 = got.get('21:≥0')!;
    expect(g1!.n).toBe(r1!.n);
    expect(g1!.periods).toBe(r1!.periods);
    expect(g1!.mean).toBeCloseTo(r1!.mean, 9);
    expect(g1!.t).toBeCloseTo(r1!.t, 9);
    expect(g1!.hit).toBeCloseTo(r1!.hit, 9);
  });

  it('фильтр exclude убирает наблюдения с v ≥ порога (n падает, паритет с эталоном)', () => {
    const lf = { enabled: true, side: 'high' as const, threshold: 30, op: 'exclude' as const };
    const got = recomputeCells(grid, panel, 'cumulative', 1900, 2100, lf)!.get('21:≥0')!;
    const noflt = recomputeCells(grid, panel, 'cumulative', 1900, 2100, { ...lf, enabled: false })!.get('21:≥0')!;
    const r = ref(obs, panel.dates, (f, v) => f >= 0 && v < 30, 1900, 2100)!;
    expect(got!.n).toBe(r.n);
    expect(got!.mean).toBeCloseTo(r.mean, 9);
    expect(got!.t).toBeCloseTo(r.t, 9);
    expect(got!.n).toBeLessThan(noflt!.n); // исключение уменьшает выборку
  });

  it('фильтр keep оставляет только v ≥ порога', () => {
    const lf = { enabled: true, side: 'high' as const, threshold: 30, op: 'keep' as const };
    const got = recomputeCells(grid, panel, 'cumulative', 1900, 2100, lf)!.get('21:≥0')!;
    const r = ref(obs, panel.dates, (f, v) => f >= 0 && v >= 30, 1900, 2100)!;
    expect(got!.n).toBe(r.n);
    expect(got!.mean).toBeCloseTo(r.mean, 9);
  });

  it('окно лет сужает выборку', () => {
    const lf = { enabled: false, side: 'high' as const, threshold: 0, op: 'exclude' as const };
    const all = recomputeCells(grid, panel, 'cumulative', 1900, 2100, lf).get('21:≥0')!;
    const one = recomputeCells(grid, panel, 'cumulative', 2021, 2021, lf).get('21:≥0');
    expect(all!.n).toBeGreaterThan((one?.n ?? 0));
  });

  it('range-биннинг: полуинтервал [lo, hi) и края', () => {
    const g: CellDef[] = [
      { param: 21, col: '<0', region: { side: 'low', threshold: 0 } },
      { param: 21, col: '0–10', region: { side: 'band', lo: 0, hi: 10 } },
      { param: 21, col: '≥10', region: { side: 'high', threshold: 10 } },
    ];
    const lf = { enabled: false, side: 'high' as const, threshold: 0, op: 'exclude' as const };
    const m = recomputeCells(g, panel, 'range', 1900, 2100, lf);
    const lo = ref(obs, panel.dates, (f) => f < 0, 1900, 2100);
    const band = ref(obs, panel.dates, (f) => f >= 0 && f < 10, 1900, 2100);
    const hi = ref(obs, panel.dates, (f) => f >= 10, 1900, 2100);
    expect(m.get('21:<0')!?.n).toBe(lo!.n);
    expect(m.get('21:0–10')!?.n).toBe(band!.n);
    expect(m.get('21:≥10')!?.n).toBe(hi!.n);
  });
});
