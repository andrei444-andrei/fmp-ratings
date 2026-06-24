// Чистая аналитика прототипа: оценка предсказательной силы прогнозов ИБ
// (сигнал → результат) и сравнение «вайт-лист по прогнозу vs держать всю
// вселенную». Функции детерминированы и не зависят от UI — позже их же
// переиспользуем на реальных данных.

import { DATA, YEARS, type CountrySeries } from './mock';

// ── Базовая статистика ──────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Ранги (средние при совпадениях) — для Спирмена.
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avgRank;
    i = j + 1;
  }
  return r;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (Math.min(xs.length, ys.length) < 3) return null;
  return pearson(ranks(xs), ranks(ys));
}

// ── Метрики предсказательной силы по стране ─────────────────────────────────

export type CountrySkill = {
  code: string;
  name: string;
  flag: string;
  n: number;
  hitRate: number;       // доля лет с верным НАПРАВЛЕНИЕМ (знак прогноза = знак факта)
  ic: number | null;     // информ. коэффициент = corr(прогноз, факт) (Пирсон)
  rankIc: number | null; // ранговая корреляция (Спирмен) — устойчивость порядка
  bias: number;          // ср.(прогноз − факт): >0 = ИБ систематически оптимистичен
  mae: number;           // ср.|прогноз − факт| — масштаб ошибки
  avgForecast: number;
  avgReal: number;
  verdict: Verdict;
};

export type Verdict = 'trade' | 'hold' | 'noise';

export const VERDICT_RU: Record<Verdict, string> = {
  trade: 'есть сигнал',
  hold: 'нейтрально',
  noise: 'шум',
};

// Эвристика вердикта (для прототипа): есть ли смысл доверять прогнозу страны.
// Сигнал — если направление угадывается заметно лучше монетки И порядок величин
// положительно скоррелирован. Шум — если корреляция отрицательная (прогноз
// «против» факта). Иначе нейтрально. На малом N (≤6) — это индикатив, не вывод.
function classify(hitRate: number, ic: number | null, rankIc: number | null): Verdict {
  const corr = ic ?? 0;
  if (corr < -0.15) return 'noise';
  if (hitRate >= 0.66 && corr > 0.2) return 'trade';
  if (hitRate >= 0.66 || (rankIc ?? 0) > 0.4) return 'trade';
  return 'hold';
}

export function countrySkill(series: CountrySeries): CountrySkill {
  const fs = series.annual.map((a) => a.forecast);
  const rs = series.annual.map((a) => a.real);
  const n = series.annual.length;
  let hits = 0;
  for (const a of series.annual) {
    const sf = Math.sign(a.forecast), sr = Math.sign(a.real);
    if (sf === 0 || sr === 0) { if (sf === sr) hits++; continue; }
    if (sf === sr) hits++;
  }
  const ic = pearson(fs, rs);
  const rankIc = spearman(fs, rs);
  const hitRate = n ? hits / n : 0;
  const errs = series.annual.map((a) => a.forecast - a.real);
  return {
    code: series.country.code,
    name: series.country.name,
    flag: series.country.flag,
    n,
    hitRate,
    ic,
    rankIc,
    bias: mean(errs),
    mae: mean(errs.map(Math.abs)),
    avgForecast: mean(fs),
    avgReal: mean(rs),
    verdict: classify(hitRate, ic, rankIc),
  };
}

export function allSkills(): CountrySkill[] {
  return DATA.map(countrySkill).sort((a, b) => (b.ic ?? -1) - (a.ic ?? -1));
}

// ── Сигнал → результат: матрица ошибок (2×2) ────────────────────────────────
// Сигнал = знак прогноза (рост/падение), результат = знак факта.
// Нейтральная зона |прогноз| < band трактуется как «рост» по умолчанию, т.к. ИБ
// почти всегда дают положительный прогноз — для прототипа band=0.

export type Confusion = {
  bullUp: number;   // прогноз рост → факт рост   (верный позитив)
  bullDown: number; // прогноз рост → факт падение (ложная тревога)
  bearUp: number;   // прогноз падение → факт рост (упущенный рост)
  bearDown: number; // прогноз падение → факт падение (верный негатив)
  total: number;
  accuracy: number;  // (bullUp+bearDown)/total
  precisionUp: number | null; // когда прогноз «рост» — как часто рос: bullUp/(bullUp+bullDown)
  baseRateUp: number;         // как часто рынок рос вообще (база сравнения)
};

export function confusion(): Confusion {
  let bullUp = 0, bullDown = 0, bearUp = 0, bearDown = 0;
  for (const s of DATA) {
    for (const a of s.annual) {
      const bull = a.forecast >= 0;
      const up = a.real >= 0;
      if (bull && up) bullUp++;
      else if (bull && !up) bullDown++;
      else if (!bull && up) bearUp++;
      else bearDown++;
    }
  }
  const total = bullUp + bullDown + bearUp + bearDown;
  const ups = bullUp + bearUp;
  const predUp = bullUp + bullDown;
  return {
    bullUp, bullDown, bearUp, bearDown, total,
    accuracy: total ? (bullUp + bearDown) / total : 0,
    precisionUp: predUp ? bullUp / predUp : null,
    baseRateUp: total ? ups / total : 0,
  };
}

// ── Вайт-лист vs вся вселенная ───────────────────────────────────────────────
// Ключевой вопрос: стоит ли отбирать страны по прогнозу ИБ, или проще держать
// всю вселенную равновесно. Для каждого года считаем равновзвешенную
// фактическую доходность двух корзин:
//  • Вселенная: все страны поровну.
//  • Вайт-лист: только страны, прошедшие правило отбора по прогнозу.
// Сравниваем накопительную, CAGR, σ, hit rate.

export type SelectionRule =
  | { kind: 'topK'; k: number }       // топ-K стран по прогнозу на каждый год
  | { kind: 'threshold'; min: number }; // прогноз ≥ min

export type YearOutcome = {
  year: number;
  universeReal: number;
  whitelistReal: number | null; // null — если в этот год ничего не отобрано
  picked: string[];             // коды стран в вайт-листе этого года
};

export type StrategyStats = {
  cumulative: number;   // накопительная за окно
  cagr: number;         // среднегодовой геометрический рост
  avg: number;          // ср. годовая
  std: number;          // σ годовых
  hitYears: number;     // лет с положительной доходностью
  n: number;
};

export type WhitelistResult = {
  rows: YearOutcome[];
  universe: StrategyStats;
  whitelist: StrategyStats;
  edgeCagr: number;     // CAGR(whitelist) − CAGR(universe)
  verdict: 'whitelist' | 'universe' | 'tossup';
  caveat: string;
};

function ewReal(year: number, codes: string[]): number | null {
  const vals: number[] = [];
  for (const s of DATA) {
    if (!codes.includes(s.country.code)) continue;
    const cell = s.annual.find((a) => a.year === year);
    if (cell) vals.push(cell.real);
  }
  return vals.length ? mean(vals) : null;
}

function statsOf(rets: (number | null)[]): StrategyStats {
  const xs = rets.filter((x): x is number => x != null);
  const n = xs.length;
  let acc = 1;
  for (const x of xs) acc *= 1 + x;
  const cumulative = acc - 1;
  const cagr = n > 0 && acc > 0 ? Math.pow(acc, 1 / n) - 1 : 0;
  const avg = mean(xs);
  const std = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1)) : 0;
  return { cumulative, cagr, avg, std, hitYears: xs.filter((x) => x > 0).length, n };
}

export function whitelistVsUniverse(
  rule: SelectionRule,
  years: number[] = YEARS,
): WhitelistResult {
  const allCodes = DATA.map((s) => s.country.code);
  const rows: YearOutcome[] = years.map((year) => {
    // прогнозы всех стран на этот год
    const fc = DATA
      .map((s) => ({ code: s.country.code, f: s.annual.find((a) => a.year === year)?.forecast }))
      .filter((x): x is { code: string; f: number } => x.f != null);
    let picked: string[];
    if (rule.kind === 'topK') {
      picked = [...fc].sort((a, b) => b.f - a.f).slice(0, rule.k).map((x) => x.code);
    } else {
      picked = fc.filter((x) => x.f >= rule.min).map((x) => x.code);
    }
    return {
      year,
      universeReal: ewReal(year, allCodes) ?? 0,
      whitelistReal: ewReal(year, picked),
      picked,
    };
  });

  const universe = statsOf(rows.map((r) => r.universeReal));
  const whitelist = statsOf(rows.map((r) => r.whitelistReal));
  const edgeCagr = whitelist.cagr - universe.cagr;

  // Вердикт прототипа. Порог «значимости» грубый: на 6 годах разница < ~1.5пп
  // CAGR статистически неразличима от нуля — честнее назвать ничьёй.
  let verdict: WhitelistResult['verdict'];
  if (edgeCagr > 0.015) verdict = 'whitelist';
  else if (edgeCagr < -0.015) verdict = 'universe';
  else verdict = 'tossup';

  const caveat =
    `Окно всего ${universe.n} ${universe.n === 1 ? 'год' : universe.n < 5 ? 'года' : 'лет'} — ` +
    `разница в CAGR ±1–2пп статистически неотличима от удачи. ` +
    `Перед решением нужны: длиннее история, поправка на риск (σ/просадка), издержки ребаланса и тест out-of-sample.`;

  return { rows, universe, whitelist, edgeCagr, verdict, caveat };
}
