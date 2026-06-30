// Движок раздела «Анализ тикера»: ЧИСТЫЕ функции без серверных импортов — бандлятся и на сервер
// (роут /api/ticker), и на клиент (мгновенный пересчёт условий/бинов, как в скринере researcher).
//
// Идея: для ОДНОГО тикера строим conditional-forward-returns по состояниям (фактор на входе → бин →
// распределение исхода за горизонт H). Главное отличие от корзины researcher — на одном инструменте
// мало НЕЗАВИСИМЫХ наблюдений, поэтому статистика подаётся честно: baseline + edge, n_eff (поправка на
// перекрытие форвардных окон), доверительный интервал, серый = незначимо, разрез по эпохам.

/* ----------------------------- базовая статистика ----------------------------- */
export const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
export function median(a: number[]): number {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const n = b.length;
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
}
export function quantileSorted(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

/* ----------------------------- факторы и форвард-доходности ----------------------------- */
export type Factors = {
  sma50: (number | null)[];
  sma200: (number | null)[];
  distAth: (number | null)[];
  smaDist50: (number | null)[];
  smaDist200: (number | null)[];
  vol21: (number | null)[];
  dd21: (number | null)[];
  dd63: (number | null)[];
  rs63: (number | null)[];
};

function smaArr(c: number[], w: number): (number | null)[] {
  const o: (number | null)[] = new Array(c.length).fill(null);
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += c[i];
    if (i >= w) s -= c[i - w];
    if (i >= w - 1) o[i] = s / w;
  }
  return o;
}
// Скользящий максимум за окно w (монотонная очередь, O(n)).
function rollMax(c: number[], w: number): number[] {
  const o = new Array(c.length).fill(0);
  const dq: number[] = [];
  for (let i = 0; i < c.length; i++) {
    while (dq.length && c[dq[dq.length - 1]] <= c[i]) dq.pop();
    dq.push(i);
    while (dq[0] <= i - w) dq.shift();
    o[i] = c[dq[0]];
  }
  return o;
}
function cumMax(c: number[]): number[] {
  const o = new Array(c.length).fill(0);
  let m = -Infinity;
  for (let i = 0; i < c.length; i++) {
    if (c[i] > m) m = c[i];
    o[i] = m;
  }
  return o;
}

/** Факторы на входе (point-in-time, без подглядывания в будущее). `spy` выровнен по датам тикера. */
export function computeFactors(closes: number[], spy: number[]): Factors {
  const n = closes.length;
  const ret = closes.map((v, i) => (i ? v / closes[i - 1] - 1 : 0));
  const sma50 = smaArr(closes, 50);
  const sma200 = smaArr(closes, 200);
  const cmax = cumMax(closes);
  const distAth = closes.map((v, i) => v / cmax[i] - 1);
  const smaDist50 = closes.map((v, i) => (sma50[i] ? v / (sma50[i] as number) - 1 : null));
  const smaDist200 = closes.map((v, i) => (sma200[i] ? v / (sma200[i] as number) - 1 : null));
  const vol21: (number | null)[] = new Array(n).fill(null);
  for (let i = 21; i < n; i++) vol21[i] = std(ret.slice(i - 20, i + 1)) * Math.sqrt(252);
  const ddw = (w: number): (number | null)[] => {
    const rm = rollMax(closes, w);
    return closes.map((v, i) => (i >= w ? v / rm[i] - 1 : null));
  };
  const hasSpy = spy.length === n;
  const rs63: (number | null)[] = closes.map((v, i) =>
    i >= 63 && hasSpy && spy[i - 63] ? closes[i] / closes[i - 63] - 1 - (spy[i] / spy[i - 63] - 1) : null,
  );
  return { sma50, sma200, distAth, smaDist50, smaDist200, vol21, dd21: ddw(21), dd63: ddw(63), rs63 };
}

/** Форвардная доходность за H дней (дневная overlapping-сетка — даёт достаточный N для одного тикера;
 *  автокорреляция перекрытия учитывается через n_eff в binStats). */
export function forwardReturns(closes: number[], H: number): (number | null)[] {
  const o: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length - H; i++) o[i] = closes[i + H] / closes[i] - 1;
  return o;
}

export const HORIZONS = [5, 10, 21, 63] as const;
const WARMUP = 200; // sma200 + достаточная история, прежде чем считать состояния

/* ----------------------------- baseline ----------------------------- */
export type Baseline = { n: number; mean: number; median: number; hit: number; std: number };
export function baselineStats(forward: (number | null)[]): Baseline {
  const v: number[] = [];
  for (let i = WARMUP; i < forward.length; i++) if (forward[i] != null) v.push(forward[i] as number);
  return { n: v.length, mean: mean(v), median: median(v), hit: v.length ? v.filter((x) => x > 0).length / v.length : 0, std: std(v) };
}

/* ----------------------------- биннинг ----------------------------- */
export type BinMode = 'auto' | 'quantile' | 'equal' | 'manual';
export type BinCfg = { mode: BinMode; k: number; minN: number; manual: number[] };

export function binIndexVal(E: number[], v: number): number {
  if (v <= E[0]) return 0;
  if (v >= E[E.length - 1]) return E.length - 2;
  for (let i = 0; i < E.length - 1; i++) if (v >= E[i] && v < E[i + 1]) return i;
  return E.length - 2;
}
function cleanEdges(E: number[]): number[] {
  let out = E.filter((x) => isFinite(x)).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-9);
  if (out.length < 2) out = [out[0] || 0, (out[0] || 0) + 1e-6];
  return out;
}
// 1-D k-means (Jenks-подобно): группирует похожие значения, выделяет хвостам отдельные кластеры —
// баланс «хвосты ↔ плотная середина». В 1-D с сортировкой кластеры всегда непрерывны → границы корректны.
export function kmeans1d(vals: number[], k: number, iters = 30): number[] {
  const v = [...vals].sort((a, b) => a - b);
  if (v.length <= k) return cleanEdges([v[0], ...v, v[v.length - 1]]);
  const cent: number[] = [];
  for (let i = 0; i < k; i++) cent.push(quantileSorted(v, (i + 0.5) / k));
  const assign = new Array(v.length).fill(0);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < v.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = Math.abs(v[i] - cent[c]);
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
    }
    const sum = new Array(k).fill(0), cnt = new Array(k).fill(0);
    for (let i = 0; i < v.length; i++) { sum[assign[i]] += v[i]; cnt[assign[i]]++; }
    let changed = false;
    for (let c = 0; c < k; c++) if (cnt[c]) { const nc = sum[c] / cnt[c]; if (Math.abs(nc - cent[c]) > 1e-12) changed = true; cent[c] = nc; }
    if (!changed) break;
  }
  const edges = [v[0]];
  for (let i = 1; i < v.length; i++) if (assign[i] !== assign[i - 1]) edges.push((v[i] + v[i - 1]) / 2);
  edges.push(v[v.length - 1]);
  return cleanEdges(edges);
}
export function makeEdges(vals: number[], cfg: BinCfg): number[] {
  const v = [...vals].sort((a, b) => a - b);
  const mn = v[0], mx = v[v.length - 1];
  let E: number[];
  if (cfg.mode === 'manual') {
    const thr = [...cfg.manual].filter((t) => t > mn && t < mx).sort((a, b) => a - b);
    E = [mn, ...thr, mx];
  } else if (cfg.mode === 'quantile') {
    E = [mn];
    for (let i = 1; i < cfg.k; i++) E.push(quantileSorted(v, i / cfg.k));
    E.push(mx);
  } else if (cfg.mode === 'equal') {
    const lo = quantileSorted(v, 0.01), hi = quantileSorted(v, 0.99), step = (hi - lo) / cfg.k;
    E = [mn];
    for (let i = 1; i < cfg.k; i++) E.push(lo + step * i);
    E.push(mx);
  } else {
    E = kmeans1d(v, cfg.k);
  }
  return cleanEdges(E);
}
// Слияние соседних бинов ниже минимума наблюдений (для auto/equal) — убирает «пустые» хвосты.
export function mergeMinN(edges: number[], vals: number[], minN: number): number[] {
  let E = [...edges];
  while (E.length - 1 > 1) {
    const nb = E.length - 1;
    const cnt = new Array(nb).fill(0);
    for (const x of vals) cnt[binIndexVal(E, x)]++;
    let idx = -1, mc = Infinity;
    for (let i = 0; i < nb; i++) if (cnt[i] < minN && cnt[i] < mc) { mc = cnt[i]; idx = i; }
    if (idx < 0) break;
    if (idx === 0) E.splice(1, 1);
    else if (idx === nb - 1) E.splice(nb - 1, 1);
    else { const left = cnt[idx - 1], right = cnt[idx + 1]; E.splice(left <= right ? idx : idx + 1, 1); }
  }
  return E;
}

export type BinUnit = 'signed' | 'pos';
export function fmtThr(v: number, unit: BinUnit): string {
  const p = v * 100;
  const d = Math.abs(p) < 10 && Math.abs(p % 1) > 1e-9 ? 1 : 0;
  return (unit === 'signed' ? (v >= 0 ? '+' : '') : '') + p.toFixed(d) + '%';
}
export type Bin = { lo: number; hi: number; last: boolean; label: string; stat: BinStat };
export type BinStat = {
  n: number; neff: number; mean: number; median: number; hit: number; std: number;
  edge: number; ciLo: number; ciHi: number; lowN: boolean; sig: boolean;
  members: number[]; epEdge: (number | null)[];
};
function labelFor(E: number[], i: number, unit: BinUnit): string {
  const last = i === E.length - 2;
  if (E.length - 1 === 1) return 'все значения';
  if (i === 0) return '< ' + fmtThr(E[i + 1], unit);
  if (last) return '≥ ' + fmtThr(E[i], unit);
  return fmtThr(E[i], unit) + '…' + fmtThr(E[i + 1], unit);
}

const EPOCHS: [number, number][] = [[0, 4], [5, 9], [10, 14], [15, 19], [20, 25]]; // последняя цифра года → 5-летние эпохи

export type BinResult = { bins: Bin[]; curVal: number | null; curBin: number; edges: number[] };

/** Главная функция: разбивает фактор на бины и считает conditional forward-returns со статистикой. */
export function binStats(
  factor: (number | null)[],
  forward: (number | null)[],
  years: number[],
  cfg: BinCfg,
  unit: BinUnit,
  baselineMean: number,
  H: number,
): BinResult {
  const fidx: number[] = [];
  for (let i = WARMUP; i < factor.length; i++) if (factor[i] != null) fidx.push(i);
  const vals = fidx.map((i) => factor[i] as number);
  let E = makeEdges(vals, cfg);
  if (cfg.mode === 'auto' || cfg.mode === 'equal') E = mergeMinN(E, vals, cfg.minN);

  const minY = years.length ? Math.min(...years) : 2000;
  const bins: Bin[] = [];
  const nb = E.length - 1;
  for (let bi = 0; bi < nb; bi++) {
    const members = fidx.filter((i) => forward[i] != null && binIndexVal(E, factor[i] as number) === bi);
    const v2 = members.map((i) => forward[i] as number);
    const n = v2.length;
    const m = mean(v2), md = median(v2), hit = n ? v2.filter((x) => x > 0).length / n : 0, sd = std(v2);
    const neff = Math.max(1, n / H);
    const se = sd / Math.sqrt(neff);
    const edge = m - baselineMean;
    const ciLo = edge - 1.96 * se, ciHi = edge + 1.96 * se;
    const lowN = neff < 10;
    const sig = !lowN && (ciLo > 0 || ciHi < 0);
    const epEdge = EPOCHS.map(([a, b]) => {
      const lo = minY + a - (minY % 5), hi = lo + (b - a);
      const ev = members.filter((i) => years[i] >= lo && years[i] <= hi).map((i) => forward[i] as number);
      return ev.length >= 8 ? mean(ev) - baselineMean : null;
    });
    bins.push({ lo: E[bi], hi: E[bi + 1], last: bi === nb - 1, label: labelFor(E, bi, unit), stat: { n, neff, mean: m, median: md, hit, std: sd, edge, ciLo, ciHi, lowN, sig, members, epEdge } });
  }
  let curVal: number | null = null;
  for (let i = factor.length - 1; i >= 0; i--) if (factor[i] != null) { curVal = factor[i] as number; break; }
  const curBin = curVal != null ? binIndexVal(E, curVal) : -1;
  return { bins, curVal, curBin, edges: E };
}

export function percentileOf(factor: (number | null)[], val: number | null): number {
  if (val == null) return 0;
  const v: number[] = [];
  for (let i = WARMUP; i < factor.length; i++) if (factor[i] != null) v.push(factor[i] as number);
  v.sort((a, b) => a - b);
  let lo = 0;
  for (let i = 0; i < v.length; i++) if (v[i] < val) lo++;
  return v.length ? lo / v.length : 0;
}

export function lastNonNull(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
  return null;
}
