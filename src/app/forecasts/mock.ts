// Прототип раздела «Прогнозы ИБ vs реальная доходность» — МОДЕЛЬ ДАННЫХ v2.
//
// Главный сдвиг: прогноз инвестбанка — это НЕ всегда число. Это сигнал на общей
// шкале, у которого есть исходный текст (цитата) и источник (URL). Прогнозы
// разнородны (overweight/underweight, buy/hold, ожидаемая доходность, просто
// текст), бывают пропуски, и на одну ячейку (страна×год) может быть несколько
// банков. Анализ строим вокруг РЕЗУЛЬТАТА (факта), устойчиво к формату и дырам.
//
// ВСЕ ДАННЫЕ — СИНТЕТИЧЕСКИЙ МОК. Реальные прогнозы будем добывать отдельными
// англоязычными запросами на (страна × год) через Perplexity Sonar (aimlapi),
// возвращающий текст + citations[] — кэш в БД, инкрементальный добор пропусков.

// «Country» исторически — теперь это актив/рынок (страна, регион или товар).
export type AssetClass = 'equity' | 'region' | 'commodity';
export type Country = { code: string; name: string; flag: string; bench: string; cls: AssetClass };

// Единая ординальная шкала сигнала (как Refinitiv I/B/E/S сводит любые шкалы к
// числу): −2 strong underweight … +2 strong overweight. На неё маппится всё.
export type SignalTier = -2 | -1 | 0 | 1 | 2;

export type ForecastFormat = 'ret' | 'target' | 'owuw' | 'buyhold' | 'qual';

export const FORMAT_RU: Record<ForecastFormat, string> = {
  ret: 'ожид. доходность',
  target: 'таргет индекса',
  owuw: 'OW/UW (отн. бенчмарка)',
  buyhold: 'buy/hold/sell',
  qual: 'качественный (текст)',
};

export const TIER: Record<SignalTier, { short: string; long: string }> = {
  2: { short: 'OW+', long: 'Strong Overweight' },
  1: { short: 'OW', long: 'Overweight' },
  0: { short: 'EW', long: 'Equal-weight / Neutral' },
  '-1': { short: 'UW', long: 'Underweight' },
  '-2': { short: 'UW−', long: 'Strong Underweight' },
};

// Один прогноз одного банка/источника на ячейку (страна×год).
export type BankForecast = {
  bank: string;
  format: ForecastFormat;
  signal: SignalTier;
  expectedReturn: number | null; // число, только если формат это позволяет
  quote: string;                 // исходная формулировка (как из источника)
  sourceName: string;            // Bloomberg / Reuters / FT / own research …
  sourceUrl: string;             // ссылка (в моке — example.com)
  asOf: string;                  // дата публикации прогноза (ISO)
};

// Ячейка: набор прогнозов (0..n; пусто = «нет прогноза») + факт (может быть null).
export type Cell = {
  year: number;
  forecasts: BankForecast[];
  real: number | null; // фактическая годовая доходность; null = «нет факта»
};

export type CountrySeries = { country: Country; cells: Cell[] };

export const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'США',            flag: '🇺🇸', bench: 'SPY',  cls: 'equity' },
  { code: 'DE', name: 'Германия',       flag: '🇩🇪', bench: 'EWG',  cls: 'equity' },
  { code: 'GB', name: 'Великобритания', flag: '🇬🇧', bench: 'EWU',  cls: 'equity' },
  { code: 'JP', name: 'Япония',         flag: '🇯🇵', bench: 'EWJ',  cls: 'equity' },
  { code: 'CN', name: 'Китай',          flag: '🇨🇳', bench: 'MCHI', cls: 'equity' },
  { code: 'IN', name: 'Индия',          flag: '🇮🇳', bench: 'INDA', cls: 'equity' },
  { code: 'BR', name: 'Бразилия',       flag: '🇧🇷', bench: 'EWZ',  cls: 'equity' },
  { code: 'PL', name: 'Польша',         flag: '🇵🇱', bench: 'EPOL', cls: 'equity' },
  { code: 'KR', name: 'Корея',          flag: '🇰🇷', bench: 'EWY',  cls: 'equity' },
  { code: 'EU', name: 'Европа (DM)',    flag: '🇪🇺', bench: 'VGK',  cls: 'region' },
  { code: 'EM', name: 'Развив. рынки',  flag: '🌐', bench: 'EEM',  cls: 'region' },
  { code: 'GLD', name: 'Золото',        flag: '🥇', bench: 'GLD',  cls: 'commodity' },
];

const BANKS = ['Goldman Sachs', 'Morgan Stanley', 'JPMorgan', 'UBS', 'BofA'];
const OUTLETS = ['Bloomberg', 'Reuters', 'Financial Times', 'own research'];

// Числовой «бэкбон» ожидаемой доходности (как в v1) + факт. На его основе
// детерминированно строим разнородные прогнозы и пропуски.
const RAW: Record<string, Record<number, [number, number | null]>> = {
  US: { 2019: [0.07, 0.31], 2020: [0.06, 0.18], 2021: [0.08, 0.29], 2022: [0.05, -0.18], 2023: [0.02, 0.26], 2024: [0.07, 0.25] },
  DE: { 2019: [0.05, 0.25], 2020: [0.03, 0.04], 2021: [0.07, 0.16], 2022: [-0.03, -0.12], 2023: [0.03, 0.20], 2024: [0.05, 0.18] },
  GB: { 2019: [0.04, 0.12], 2020: [0.02, -0.14], 2021: [0.05, 0.14], 2022: [0.03, 0.01], 2023: [0.02, 0.04], 2024: [0.04, 0.06] },
  JP: { 2019: [0.03, 0.18], 2020: [0.02, 0.16], 2021: [-0.01, 0.05], 2022: [-0.02, -0.09], 2023: [0.04, 0.28], 2024: [0.06, 0.19] },
  CN: { 2019: [0.08, 0.20], 2020: [0.10, 0.27], 2021: [0.09, -0.22], 2022: [0.07, -0.24], 2023: [-0.04, -0.13], 2024: [-0.06, 0.15] },
  IN: { 2019: [0.09, 0.13], 2020: [0.07, 0.15], 2021: [0.10, 0.24], 2022: [0.08, 0.04], 2023: [0.09, 0.19], 2024: [0.11, 0.12] },
  BR: { 2019: [0.06, 0.32], 2020: [0.05, 0.03], 2021: [0.08, -0.12], 2022: [0.04, 0.04], 2023: [0.06, 0.22], 2024: [0.07, -0.10] },
  PL: { 2019: [0.04, null], 2020: [0.03, -0.01], 2021: [0.06, 0.21], 2022: [-0.02, -0.17], 2023: [0.05, 0.36], 2024: [0.05, 0.12] },
  KR: { 2019: [0.06, 0.09], 2020: [0.05, 0.45], 2021: [0.08, -0.10], 2022: [0.04, -0.29], 2023: [0.07, 0.22], 2024: [0.06, -0.10] },
  EU: { 2019: [0.05, 0.24], 2020: [0.03, 0.05], 2021: [0.07, 0.16], 2022: [-0.02, -0.15], 2023: [0.04, 0.20], 2024: [0.05, 0.02] },
  EM: { 2019: [0.07, 0.18], 2020: [0.08, 0.18], 2021: [0.06, -0.03], 2022: [0.05, -0.20], 2023: [0.07, 0.09], 2024: [0.08, 0.08] },
  GLD: { 2019: [0.02, 0.18], 2020: [0.04, 0.25], 2021: [0.03, -0.04], 2022: [-0.01, -0.01], 2023: [0.02, 0.13], 2024: [0.01, 0.27] },
};

// Намеренные пропуски ПРОГНОЗА (демонстрация «нет прогноза»): тут forecasts=[].
const FORECAST_GAPS = new Set(['BR:2020', 'PL:2019', 'JP:2020']);

// ── детерминированный ГПСЧ (без Math.random — прототип стабилен) ──────────────
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295; // 0..1
}
const clampTier = (n: number): SignalTier => (Math.max(-2, Math.min(2, Math.round(n))) as SignalTier);

// Ожидаемая доходность → тир сигнала (нейтральная зона = «как рынок»).
export function tierFromReturn(f: number): SignalTier {
  if (f >= 0.10) return 2;
  if (f >= 0.05) return 1;
  if (f > -0.02) return 0;
  if (f > -0.06) return -1;
  return -2;
}

function quoteFor(fmt: ForecastFormat, sig: SignalTier, er: number | null, country: string): string {
  const pct = er != null ? (er > 0 ? '+' : '') + Math.round(er * 100) + '%' : '';
  switch (fmt) {
    case 'owuw':
      return sig >= 2 ? `${country}: Overweight, top regional pick`
        : sig === 1 ? `We move ${country} to Overweight`
        : sig === 0 ? `${country}: Equal-weight (market-weight)`
        : sig === -1 ? `Underweight ${country} on relative basis`
        : `Strong Underweight — least preferred market`;
    case 'buyhold':
      return sig >= 1 ? `Constructive on ${country} equities — Buy`
        : sig === 0 ? `${country}: Hold, balanced risk/reward`
        : `${country}: reduce exposure (Underperform)`;
    case 'ret':
      return `We forecast ${country} equities to return ~${pct} next year`;
    case 'target':
      return `Year-end index target implies ~${pct} upside for ${country}`;
    case 'qual':
    default:
      return sig >= 1 ? `Constructive: supportive earnings and valuations in ${country}`
        : sig === 0 ? `Range-bound; we stay neutral on ${country}`
        : `Cautious on ${country} amid headwinds`;
  }
}

function buildForecasts(code: string, year: number, baseF: number): BankForecast[] {
  if (FORECAST_GAPS.has(`${code}:${year}`)) return [];
  const seed = hash(`${code}:${year}`);
  const n = 1 + Math.floor(seed * 3); // 1..3 банка
  const tier0 = tierFromReturn(baseF);
  const out: BankForecast[] = [];
  for (let i = 0; i < n; i++) {
    const bank = BANKS[Math.floor(hash(`${code}:${year}:${i}:b`) * BANKS.length)];
    const jit = Math.floor(hash(`${code}:${year}:${i}:j`) * 3) - 1; // −1..+1 разброс мнений
    const sig = clampTier(tier0 + jit);
    const fmts: ForecastFormat[] = ['owuw', 'ret', 'buyhold', 'qual', 'target'];
    const fmt = fmts[Math.floor(hash(`${code}:${year}:${i}:f`) * fmts.length)];
    // числовая доходность есть только у числовых форматов
    const er = fmt === 'ret' || fmt === 'target'
      ? Math.round((baseF + (hash(`${code}:${year}:${i}:e`) - 0.5) * 0.03) * 100) / 100
      : null;
    const outlet = OUTLETS[Math.floor(hash(`${code}:${year}:${i}:o`) * OUTLETS.length)];
    out.push({
      bank,
      format: fmt,
      signal: sig,
      expectedReturn: er,
      quote: quoteFor(fmt, sig, er, code),
      sourceName: outlet === 'own research' ? `${bank} Research` : outlet,
      sourceUrl: `https://example.com/${bank.toLowerCase().replace(/[^a-z]+/g, '-')}/${code}-${year}-outlook`,
      asOf: `${year - 1}-12-${String(8 + i * 4).padStart(2, '0')}`,
    });
  }
  return out;
}

export const DATA: CountrySeries[] = COUNTRIES.map((country) => ({
  country,
  cells: YEARS.map((year) => {
    const [baseF, real] = RAW[country.code][year];
    return { year, forecasts: buildForecasts(country.code, year, baseF), real };
  }),
}));

// ── консенсус по ячейке ──────────────────────────────────────────────────────
export type Consensus = {
  signal: number | null;   // медиана сигналов банков (null = нет прогноза)
  tier: SignalTier | null; // округлённый тир для отображения
  n: number;               // сколько банков
  spread: number;          // разброс мнений (max−min сигнала)
  expectedReturn: number | null; // медиана числовых прогнозов, если есть
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function consensusOf(cell: Cell): Consensus {
  if (!cell.forecasts.length) return { signal: null, tier: null, n: 0, spread: 0, expectedReturn: null };
  const sigs = cell.forecasts.map((f) => f.signal);
  const ers = cell.forecasts.map((f) => f.expectedReturn).filter((x): x is number => x != null);
  const sig = median(sigs);
  return {
    signal: sig,
    tier: clampTier(sig),
    n: cell.forecasts.length,
    spread: Math.max(...sigs) - Math.min(...sigs),
    expectedReturn: ers.length ? median(ers) : null,
  };
}

export function cellOf(code: string, year: number): Cell | undefined {
  return DATA.find((s) => s.country.code === code)?.cells.find((c) => c.year === year);
}

// ── поквартальная раскадровка факта (как в v1) ───────────────────────────────
function quarterWeights(seed: number): [number, number, number, number] {
  const shapes: [number, number, number, number][] = [
    [0.40, 0.10, 0.20, 0.30], [0.15, 0.35, 0.30, 0.20], [0.30, 0.30, 0.10, 0.30],
    [0.10, 0.25, 0.40, 0.25], [0.35, 0.25, 0.25, 0.15], [0.20, 0.15, 0.30, 0.35],
  ];
  return shapes[Math.floor(seed * shapes.length) % shapes.length];
}
export function quarterize(code: string, year: number, real: number): number[] {
  const w = quarterWeights(hash(code + ':' + year));
  const logTotal = Math.log(1 + real);
  return w.map((wi) => Math.exp(wi * logTotal) - 1);
}
export function cumulativePath(quarters: number[]): number[] {
  const out: number[] = []; let acc = 1;
  for (const q of quarters) { acc *= 1 + q; out.push(acc - 1); }
  return out;
}
