// Риск/корреляция портфеля стратегий (client-safe). Считается из дневных рядов:
// доходности по выбранному разрешению, корреляционная матрица (Pearson/ранговая),
// собственные числа (ENB / доля 1-й компоненты), diversification ratio,
// downside-корреляция (в падения рынка) и маржинальное правило диверсификации.

import type { DayPoint } from './types';

export type ReturnsResolution = 'D' | 'W' | 'M';
export type CorrMethod = 'pearson' | 'spearman';

export type RiskInput = { id: number; name: string; daily: DayPoint[] };

export type PerStrategyRisk = {
  id: number; name: string;
  sharpe: number | null; vol: number | null;      // годовые
  avgCorr: number | null;                          // ср. корреляция с остальными
  corrBench: number | null;                        // корреляция с SPY
  improves: boolean | null;                        // Sᵢ > ρ·S_rest (leave-one-out)
};

export type RiskResult = {
  ids: number[]; names: string[];
  resolution: ReturnsResolution;
  obs: number;                                     // число наблюдений (доходностей)
  corr: number[][];                                // матрица корреляций (method)
  perStrategy: PerStrategyRisk[];
  avgCorr: number | null;                          // ср. внедиагональная
  enb: number | null;                              // effective number of bets
  pc1: number | null;                              // доля дисперсии 1-й компоненты
  divRatio: number | null;
  downCorr: number[][] | null;                     // корреляция при SPY<0
  downObs: number;
};

const ANN: Record<ReturnsResolution, number> = { D: 252, W: 52, M: 12 };

function periodKey(d: string, res: ReturnsResolution): string {
  if (res === 'M') return d.slice(0, 7);
  if (res === 'D') return d;
  const days = Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);
  return 'W' + String(Math.floor(days / 7)).padStart(8, '0');
}
function resample(daily: DayPoint[], res: ReturnsResolution): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of [...daily].sort((a, b) => (a.d < b.d ? -1 : 1))) m.set(periodKey(p.d, res), p.v);
  return m;
}

function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function stdSample(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const d = Math.sqrt(sxx * syy);
  return d > 0 ? sxy / d : 0;
}
function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(x.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function corr(x: number[], y: number[], method: CorrMethod): number {
  return method === 'spearman' ? pearson(ranks(x), ranks(y)) : pearson(x, y);
}

// Собственные числа симметричной матрицы (Jacobi). N небольшое.
function jacobiEigenvalues(M: number[][]): number[] {
  const n = M.length;
  const a = M.map(r => r.slice());
  for (let iter = 0; iter < 100; iter++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-14) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const sgn = theta >= 0 ? 1 : -1;
      const t = sgn / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let i = 0; i < n; i++) { const aip = a[i][p], aiq = a[i][q]; a[i][p] = c * aip - s * aiq; a[i][q] = s * aip + c * aiq; }
      for (let i = 0; i < n; i++) { const api = a[p][i], aqi = a[q][i]; a[p][i] = c * api - s * aqi; a[q][i] = s * api + c * aqi; }
    }
  }
  return a.map((r, i) => r[i]);
}

function matrix(rets: number[][], method: CorrMethod): number[][] {
  const n = rets.length;
  const C = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    C[i][i] = 1;
    for (let j = i + 1; j < n; j++) { const c = corr(rets[i], rets[j], method); C[i][j] = c; C[j][i] = c; }
  }
  return C;
}

export function computeRisk(
  inputs: RiskInput[], benchmarkDaily: DayPoint[] | null,
  resolution: ReturnsResolution, method: CorrMethod,
): RiskResult | null {
  const sel = inputs.filter(i => i.daily.length >= 4);
  if (sel.length < 2) return null;

  const maps = sel.map(s => resample(s.daily, resolution));
  const benchMap = benchmarkDaily && benchmarkDaily.length >= 4 ? resample(benchmarkDaily, resolution) : null;

  let common = [...maps[0].keys()];
  for (let i = 1; i < maps.length; i++) { const mm = maps[i]; common = common.filter(k => mm.has(k)); }
  if (benchMap) common = common.filter(k => benchMap.has(k));
  common.sort();
  const L = common.length;
  if (L < 4) return null; // <3 доходностей

  const rets = maps.map(m => { const r: number[] = []; for (let k = 1; k < L; k++) r.push(m.get(common[k])! / m.get(common[k - 1])! - 1); return r; });
  const benchRet = benchMap ? (() => { const r: number[] = []; for (let k = 1; k < L; k++) r.push(benchMap.get(common[k])! / benchMap.get(common[k - 1])! - 1); return r; })() : null;
  const obs = L - 1;
  const ann = ANN[resolution];
  const n = sel.length;
  const all = sel.map((_, i) => i);

  const C = matrix(rets, method);

  const sharpeOf = (r: number[]) => { const sd = stdSample(r); return sd > 0 ? (mean(r) / sd) * Math.sqrt(ann) : null; };
  const ewReturns = (idxs: number[]) => { const out: number[] = []; for (let k = 0; k < obs; k++) { let s = 0; for (const i of idxs) s += rets[i][k]; out.push(s / idxs.length); } return out; };

  const perStrategy: PerStrategyRisk[] = sel.map((s, i) => {
    const others = all.filter(j => j !== i);
    const avgCorr = others.length ? others.reduce((a, j) => a + C[i][j], 0) / others.length : null;
    const sharpe = sharpeOf(rets[i]);
    const vol = stdSample(rets[i]) * Math.sqrt(ann);
    const corrBench = benchRet ? corr(rets[i], benchRet, method) : null;
    let improves: boolean | null = null;
    if (others.length) {
      const rest = ewReturns(others);
      const sRest = sharpeOf(rest);
      const rho = corr(rets[i], rest, method);
      if (sharpe != null && sRest != null) improves = sharpe > rho * sRest;
    }
    return { id: s.id, name: s.name, sharpe, vol, avgCorr, corrBench, improves };
  });

  // средняя внедиагональная
  let sumOff = 0, cnt = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { sumOff += C[i][j]; cnt++; }
  const avgCorr = cnt ? sumOff / cnt : null;

  // ENB / доля 1-й компоненты
  const ev = jacobiEigenvalues(C).map(v => Math.max(v, 0));
  const evSum = ev.reduce((s, x) => s + x, 0) || 1;
  const p = ev.map(v => v / evSum).filter(x => x > 1e-9);
  const enb = p.length ? Math.exp(-p.reduce((s, x) => s + x * Math.log(x), 0)) : null;
  const pc1 = Math.max(...ev) / evSum;

  // diversification ratio (равные веса)
  const vols = rets.map(r => stdSample(r));
  const ewAll = ewReturns(all);
  const spStd = stdSample(ewAll);
  const divRatio = spStd > 0 ? mean(vols) / spStd : null;

  // downside-корреляция (SPY < 0)
  let downCorr: number[][] | null = null, downObs = 0;
  if (benchRet) {
    const mask: number[] = [];
    for (let k = 0; k < obs; k++) if (benchRet[k] < 0) mask.push(k);
    downObs = mask.length;
    if (mask.length >= 5) {
      const downRets = rets.map(r => mask.map(k => r[k]));
      downCorr = matrix(downRets, method);
    }
  }

  return {
    ids: sel.map(s => s.id), names: sel.map(s => s.name),
    resolution, obs, corr: C, perStrategy, avgCorr, enb, pc1, divRatio, downCorr, downObs,
  };
}
