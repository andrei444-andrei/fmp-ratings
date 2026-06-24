// Аналитика прототипа v2. Центр тяжести — на РЕЗУЛЬТАТЕ и связи «сигнал →
// результат», устойчиво к разнородному формату прогноза и пропускам.
//
// Первичные метрики — ранговые/категориальные (работают на OW/UW и при дырах):
//   • кросс-секционный Rank IC (Спирмен) сигнал-ранг vs факт-ранг, по годам;
//   • спред OW−UW (доходность OW-корзины минус UW-корзины);
//   • матрица тиров (сигнал × результат).
// Вторичные — числовые (Pearson IC, MAE, смещение) только где есть число.
// Все функции чистые — переиспользуем на реальных данных.

import { DATA, YEARS, consensusOf, type SignalTier, type CountrySeries } from './mock';

// ── базовая статистика ───────────────────────────────────────────────────────
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
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
export function spearman(xs: number[], ys: number[]): number | null {
  if (Math.min(xs.length, ys.length) < 3) return null;
  return pearson(ranks(xs), ranks(ys));
}

// Пары (консенсус-сигнал, факт) по всем странам данного года — только где есть оба.
function pairsForYear(year: number): { sig: number; real: number; code: string }[] {
  const out: { sig: number; real: number; code: string }[] = [];
  for (const s of DATA) {
    const cell = s.cells.find((c) => c.year === year);
    if (!cell || cell.real == null) continue;
    const con = consensusOf(cell);
    if (con.signal == null) continue;
    out.push({ sig: con.signal, real: cell.real, code: s.country.code });
  }
  return out;
}

// ── 1) Кросс-секционный Rank IC по годам ─────────────────────────────────────
export type YearIC = { year: number; ic: number | null; n: number };
export type RankIC = {
  byYear: YearIC[];
  meanIC: number | null;
  stdIC: number | null;
  tStat: number | null; // mean / (std/√k) по годам с валидным IC
  kYears: number;
};

export function rankIC(years: number[] = YEARS): RankIC {
  const byYear: YearIC[] = years.map((year) => {
    const p = pairsForYear(year);
    return { year, ic: spearman(p.map((x) => x.sig), p.map((x) => x.real)), n: p.length };
  });
  const ics = byYear.map((y) => y.ic).filter((x): x is number => x != null);
  const meanIC = ics.length ? mean(ics) : null;
  const stdIC = ics.length > 1 ? std(ics) : null;
  const tStat = meanIC != null && stdIC != null && stdIC > 0 ? meanIC / (stdIC / Math.sqrt(ics.length)) : null;
  return { byYear, meanIC, stdIC, tStat, kYears: ics.length };
}

// ── 2) Спред OW−UW по годам ──────────────────────────────────────────────────
// Естественный тест навыка для относительных рейтингов: доходность корзины
// overweight минус корзины underweight. Обобщает «вайт-лист».
export type YearSpread = {
  year: number;
  owReal: number | null; uwReal: number | null; spread: number | null;
  owN: number; uwN: number;
};
export type SpreadResult = {
  rows: YearSpread[];
  avgSpread: number | null;
  hitYears: number;   // лет со spread > 0
  validYears: number; // лет, где есть и OW, и UW корзины
};

export function owUwSpread(years: number[] = YEARS): SpreadResult {
  const rows: YearSpread[] = years.map((year) => {
    const p = pairsForYear(year);
    const ow = p.filter((x) => x.sig > 0).map((x) => x.real);
    const uw = p.filter((x) => x.sig < 0).map((x) => x.real);
    const owReal = ow.length ? mean(ow) : null;
    const uwReal = uw.length ? mean(uw) : null;
    return {
      year,
      owReal, uwReal,
      spread: owReal != null && uwReal != null ? owReal - uwReal : null,
      owN: ow.length, uwN: uw.length,
    };
  });
  const spreads = rows.map((r) => r.spread).filter((x): x is number => x != null);
  return {
    rows,
    avgSpread: spreads.length ? mean(spreads) : null,
    hitYears: spreads.filter((x) => x > 0).length,
    validYears: spreads.length,
  };
}

// ── 3) Матрица тиров (сигнал → результат) ────────────────────────────────────
// Строки: OW (тир>0) / EW (тир=0) / UW (тир<0); столбцы: факт рост/падение.
export type TierMatrix = {
  rows: { tier: 'OW' | 'EW' | 'UW'; up: number; down: number }[];
  total: number;
  // точность направленных колов: OW→рост и UW→падение верны; EW — «нет кола».
  directionalCorrect: number;
  directionalTotal: number;
  baseRateUp: number;
};

export function tierMatrix(): TierMatrix {
  const acc = { OW: { up: 0, down: 0 }, EW: { up: 0, down: 0 }, UW: { up: 0, down: 0 } };
  let ups = 0, total = 0;
  for (const s of DATA) {
    for (const cell of s.cells) {
      if (cell.real == null) continue;
      const con = consensusOf(cell);
      if (con.tier == null) continue;
      const bucket = con.tier > 0 ? 'OW' : con.tier < 0 ? 'UW' : 'EW';
      const up = cell.real >= 0;
      acc[bucket][up ? 'up' : 'down']++;
      if (up) ups++;
      total++;
    }
  }
  const directionalCorrect = acc.OW.up + acc.UW.down;
  const directionalTotal = acc.OW.up + acc.OW.down + acc.UW.up + acc.UW.down;
  return {
    rows: [
      { tier: 'OW', ...acc.OW },
      { tier: 'EW', ...acc.EW },
      { tier: 'UW', ...acc.UW },
    ],
    total,
    directionalCorrect,
    directionalTotal,
    baseRateUp: total ? ups / total : 0,
  };
}

// ── 4) Числовые метрики (только где банк дал число) ──────────────────────────
export type NumericMetrics = { n: number; ic: number | null; mae: number; bias: number };
export function numericMetrics(): NumericMetrics {
  const fs: number[] = [], rs: number[] = [];
  for (const s of DATA) {
    for (const cell of s.cells) {
      if (cell.real == null) continue;
      const er = consensusOf(cell).expectedReturn;
      if (er == null) continue;
      fs.push(er); rs.push(cell.real);
    }
  }
  const errs = fs.map((f, i) => f - rs[i]);
  return { n: fs.length, ic: pearson(fs, rs), mae: mean(errs.map(Math.abs)), bias: mean(errs) };
}

// ── 5) Навык по стране (time-series, на консенсус-сигнале) ────────────────────
export type Verdict = 'trade' | 'hold' | 'noise';
export const VERDICT_RU: Record<Verdict, string> = { trade: 'есть сигнал', hold: 'нейтрально', noise: 'шум' };

export type CountrySkill = {
  code: string; name: string; flag: string;
  coverage: number;        // доля лет с прогнозом
  pairs: number;           // лет с прогнозом И фактом
  hitRate: number | null;  // направление (исключая EW и пропуски)
  rankIc: number | null;   // Спирмен(сигнал, факт) по годам
  numericIc: number | null;
  verdict: Verdict;
};

export function countrySkill(series: CountrySeries): CountrySkill {
  const sigs: number[] = [], reals: number[] = [], ers: number[] = [], erReals: number[] = [];
  let withForecast = 0, hits = 0, dirN = 0;
  for (const cell of series.cells) {
    const con = consensusOf(cell);
    if (con.signal != null) withForecast++;
    if (con.signal == null || cell.real == null) continue;
    sigs.push(con.signal); reals.push(cell.real);
    if (con.signal !== 0) { dirN++; if (Math.sign(con.signal) === Math.sign(cell.real)) hits++; }
    if (con.expectedReturn != null) { ers.push(con.expectedReturn); erReals.push(cell.real); }
  }
  const rankIc = spearman(sigs, reals);
  const hitRate = dirN ? hits / dirN : null;
  const numericIc = ers.length >= 3 ? pearson(ers, erReals) : null;
  const corr = rankIc ?? 0;
  let verdict: Verdict;
  if (corr < -0.2) verdict = 'noise';
  else if ((hitRate != null && hitRate >= 0.66 && corr > 0.2) || corr > 0.5) verdict = 'trade';
  else verdict = 'hold';
  return {
    code: series.country.code, name: series.country.name, flag: series.country.flag,
    coverage: series.cells.length ? withForecast / series.cells.length : 0,
    pairs: sigs.length, hitRate, rankIc, numericIc, verdict,
  };
}
export function allSkills(): CountrySkill[] {
  return DATA.map(countrySkill).sort((a, b) => (b.rankIc ?? -2) - (a.rankIc ?? -2));
}

// ── 6) Покрытие ──────────────────────────────────────────────────────────────
export type Coverage = { cells: number; withForecast: number; withReal: number; withBoth: number };
export function coverage(): Coverage {
  let cells = 0, wf = 0, wr = 0, wb = 0;
  for (const s of DATA) for (const cell of s.cells) {
    cells++;
    const hasF = cell.forecasts.length > 0;
    const hasR = cell.real != null;
    if (hasF) wf++;
    if (hasR) wr++;
    if (hasF && hasR) wb++;
  }
  return { cells, withForecast: wf, withReal: wr, withBoth: wb };
}

// ── 7) Вайт-лист по сигналу vs вся вселенная ─────────────────────────────────
export type SelectionRule =
  | { kind: 'tier'; min: SignalTier } // держим страны с консенсус-тиром ≥ min
  | { kind: 'topK'; k: number };      // топ-K по консенсус-сигналу

export type YearOutcome = { year: number; universeReal: number | null; whitelistReal: number | null; picked: string[] };
export type StrategyStats = { cumulative: number; cagr: number; avg: number; std: number; hitYears: number; n: number };
export type WhitelistResult = {
  rows: YearOutcome[];
  universe: StrategyStats; whitelist: StrategyStats;
  edgeCagr: number; verdict: 'whitelist' | 'universe' | 'tossup'; caveat: string;
};

function statsOf(rets: (number | null)[]): StrategyStats {
  const xs = rets.filter((x): x is number => x != null);
  const n = xs.length;
  let acc = 1; for (const x of xs) acc *= 1 + x;
  const cumulative = acc - 1;
  const cagr = n > 0 && acc > 0 ? Math.pow(acc, 1 / n) - 1 : 0;
  const avg = mean(xs);
  return { cumulative, cagr, avg, std: std(xs), hitYears: xs.filter((x) => x > 0).length, n };
}

export function whitelistVsUniverse(rule: SelectionRule, years: number[] = YEARS): WhitelistResult {
  const rows: YearOutcome[] = years.map((year) => {
    const all: { code: string; sig: number | null; real: number | null }[] = DATA.map((s) => {
      const cell = s.cells.find((c) => c.year === year)!;
      return { code: s.country.code, sig: consensusOf(cell).signal, real: cell.real };
    });
    const universeVals = all.filter((x) => x.real != null).map((x) => x.real as number);
    let picked: string[];
    if (rule.kind === 'topK') {
      picked = all.filter((x) => x.sig != null).sort((a, b) => (b.sig as number) - (a.sig as number))
        .slice(0, rule.k).map((x) => x.code);
    } else {
      picked = all.filter((x) => x.sig != null && (x.sig as number) >= rule.min).map((x) => x.code);
    }
    const wlVals = all.filter((x) => picked.includes(x.code) && x.real != null).map((x) => x.real as number);
    return {
      year,
      universeReal: universeVals.length ? mean(universeVals) : null,
      whitelistReal: wlVals.length ? mean(wlVals) : null,
      picked,
    };
  });

  const universe = statsOf(rows.map((r) => r.universeReal));
  const whitelist = statsOf(rows.map((r) => r.whitelistReal));
  const edgeCagr = whitelist.cagr - universe.cagr;
  const verdict = edgeCagr > 0.015 ? 'whitelist' : edgeCagr < -0.015 ? 'universe' : 'tossup';
  const caveat =
    `Окно ${universe.n} ${universe.n === 1 ? 'год' : universe.n < 5 ? 'года' : 'лет'}; часть ячеек — пропуски прогноза/факта. ` +
    `Разница ±1–2пп CAGR статистически неотличима от удачи. Нужны: длиннее история, поправка на риск, издержки ребаланса, out-of-sample.`;
  return { rows, universe, whitelist, edgeCagr, verdict, caveat };
}
