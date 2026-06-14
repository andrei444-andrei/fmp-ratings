// Конфигурация и пресеты вселенной для модуля факторной модели сигналов (/signals).
// Чистые данные/типы (без серверных зависимостей) — импортируется и на клиенте (страница),
// и на сервере (роут исполнения). Единый источник правды по дефолтам и вселенным.

export type BaseSignalType = 'ts_low' | 'ts_high' | 'abs_high' | 'abs_low' | 'band';

// Базовый (триггерный) сигнал-событие. Это «база» модели: моментум-экстремумы и пороги,
// которые задают режим; вторичные факторы потом модулируют ожидаемую доходность внутри события.
export type BaseSignal = {
  name: string;        // человекочитаемое имя (попадает в отчёт)
  feature: string;     // на какой фиче строится событие (внутренний ключ фичи)
  type: BaseSignalType;
  dir: 'long' | 'short'; // ожидаемое направление избыточной доходности при активном событии
  z?: number;          // порог для ts_low/ts_high (в σ по rolling-окну)
  thr?: number;        // порог для abs_high/abs_low
  lo?: number;         // нижняя граница для band
  hi?: number;         // верхняя граница для band
};

export type SignalConfig = {
  universe: string[];      // тикеры (без бенчмарка)
  benchmark: string;       // напр. 'SPY'
  start?: string;          // YYYY-MM-DD (опц.)
  end?: string;            // YYYY-MM-DD (опц.)
  horizonDays: number;     // форвардный горизонт таргета (торг. дни): 5 = неделя
  stepDays: number;        // шаг сэмплинга (без перекрытия = horizonDays)
  fdrAlpha: number;        // уровень FDR (Benjamini-Hochberg)
  ridgeLambda: number;     // регуляризация Ridge для комбинированной модели
  enetL1: number;          // L1 для ElasticNet (отсев коллинеарных дубликатов)
  enetL2: number;          // L2 для ElasticNet
  walkforwardMinTrain: number; // мин. число периодов в train перед первым OOS-предсказанием
  zWindow: number;         // окно rolling-z для ts_low/ts_high (торг. дни)
  maxSymbols: number;      // ограничение размера вселенной (время исполнения)
  baseSignals: BaseSignal[];
};

// Страновые ETF (US-листинг) — как в /research (без SPY: он бенчмарк).
export const COUNTRY_ETFS = [
  'QQQ', 'EWJ', 'EWG', 'EWU', 'EWQ', 'EWL', 'EWI', 'EWP', 'EWC', 'EWA',
  'FXI', 'MCHI', 'EWH', 'EWT', 'EWY', 'INDA', 'EWZ', 'EWW', 'EZA', 'EPOL',
  'TUR', 'THD', 'EEM', 'VGK', 'ACWI',
];

// Секторные SPDR + расширенные секторные.
export const SECTOR_ETFS = [
  'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC',
];

// Факторные / стилевые ETF.
export const FACTOR_ETFS = [
  'MTUM', 'VLUE', 'QUAL', 'USMV', 'SIZE', 'VUG', 'VTV', 'IWF', 'IWD', 'IWM', 'IJH', 'IJR',
];

// Крупные акции (мега-кап).
export const MEGA_STOCKS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'V', 'UNH',
  'XOM', 'JNJ', 'WMT', 'PG', 'MA', 'HD', 'COST', 'ORCL', 'AVGO', 'LLY',
];

export type UniversePreset = 'country' | 'sector' | 'factor' | 'mega' | 'broad' | 'all';

export const UNIVERSE_PRESETS: { id: UniversePreset; label: string; tickers: string[] }[] = [
  { id: 'country', label: 'Страновые ETF', tickers: COUNTRY_ETFS },
  { id: 'sector', label: 'Секторные ETF', tickers: SECTOR_ETFS },
  { id: 'factor', label: 'Факторные / стилевые ETF', tickers: FACTOR_ETFS },
  { id: 'mega', label: 'Крупные акции', tickers: MEGA_STOCKS },
  {
    id: 'broad',
    label: 'Широкая: страновые + секторные + факторные',
    tickers: [...COUNTRY_ETFS, ...SECTOR_ETFS, ...FACTOR_ETFS],
  },
  {
    id: 'all',
    label: 'Всё: + крупные акции',
    tickers: [...COUNTRY_ETFS, ...SECTOR_ETFS, ...FACTOR_ETFS, ...MEGA_STOCKS],
  },
];

// Базовые сигналы по умолчанию — кодируют 4 находки пользователя.
export const DEFAULT_BASE_SIGNALS: BaseSignal[] = [
  { name: '1н-моментум: аномально низкий (z < −1.5)', feature: 'mom_1w', type: 'ts_low', z: 1.5, dir: 'long' },
  { name: '1м-избыток к бенчмарку > 10 пп', feature: 'xmom_1m', type: 'abs_high', thr: 10, dir: 'long' },
  { name: 'волатильность 20д > 25% год.', feature: 'vol20', type: 'abs_high', thr: 25, dir: 'long' },
  { name: 'близко к ATH: расстояние в [−2; 0]%', feature: 'dd_ath', type: 'band', lo: -2, hi: 0, dir: 'long' },
];

export function defaultConfig(): SignalConfig {
  return {
    universe: [...COUNTRY_ETFS, ...SECTOR_ETFS, ...FACTOR_ETFS],
    benchmark: 'SPY',
    horizonDays: 5,
    stepDays: 5,
    fdrAlpha: 0.1,
    ridgeLambda: 10,
    enetL1: 0.05,
    enetL2: 0.05,
    walkforwardMinTrain: 52,
    zWindow: 252,
    maxSymbols: 120,
    baseSignals: DEFAULT_BASE_SIGNALS,
  };
}

const VALID_BASE_TYPES: BaseSignalType[] = ['ts_low', 'ts_high', 'abs_high', 'abs_low', 'band'];

function num(v: unknown, dflt: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

// Приводим присланный с клиента конфиг к безопасному виду (дефолты + клампы).
export function normalizeConfig(input: unknown): SignalConfig {
  const d = defaultConfig();
  const c = (input ?? {}) as Partial<SignalConfig> & { universe?: unknown };

  const benchmark = (typeof c.benchmark === 'string' && c.benchmark.trim()
    ? c.benchmark
    : d.benchmark
  ).toUpperCase().trim();

  const rawUniverse = Array.isArray(c.universe) ? c.universe : d.universe;
  const universe = [
    ...new Set(
      rawUniverse
        .map((s) => String(s).toUpperCase().trim())
        .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) && s !== benchmark),
    ),
  ].slice(0, num(c.maxSymbols, d.maxSymbols, 4, 200));

  const horizonDays = Math.round(num(c.horizonDays, d.horizonDays, 1, 63));
  const stepDays = Math.round(num(c.stepDays, horizonDays, 1, 63));

  let baseSignals: BaseSignal[] = Array.isArray(c.baseSignals)
    ? c.baseSignals
        .map((b): BaseSignal | null => {
          const bb = (b ?? {}) as Partial<BaseSignal>;
          if (typeof bb.feature !== 'string' || !VALID_BASE_TYPES.includes(bb.type as BaseSignalType)) {
            return null;
          }
          return {
            name: typeof bb.name === 'string' && bb.name.trim() ? bb.name.trim() : String(bb.feature),
            feature: bb.feature,
            type: bb.type as BaseSignalType,
            dir: bb.dir === 'short' ? 'short' : 'long',
            z: bb.z != null ? num(bb.z, 1.5, 0.25, 5) : undefined,
            thr: bb.thr != null ? num(bb.thr, 0, -1e6, 1e6) : undefined,
            lo: bb.lo != null ? num(bb.lo, 0, -1e6, 1e6) : undefined,
            hi: bb.hi != null ? num(bb.hi, 0, -1e6, 1e6) : undefined,
          };
        })
        .filter((x): x is BaseSignal => x != null)
    : d.baseSignals;
  if (!baseSignals.length) baseSignals = d.baseSignals;

  return {
    universe: universe.length ? universe : d.universe,
    benchmark,
    start: typeof c.start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.start) ? c.start.slice(0, 10) : undefined,
    end: typeof c.end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.end) ? c.end.slice(0, 10) : undefined,
    horizonDays,
    stepDays,
    fdrAlpha: num(c.fdrAlpha, d.fdrAlpha, 0.01, 0.5),
    ridgeLambda: num(c.ridgeLambda, d.ridgeLambda, 0, 1e6),
    enetL1: num(c.enetL1, d.enetL1, 0, 100),
    enetL2: num(c.enetL2, d.enetL2, 0, 100),
    walkforwardMinTrain: Math.round(num(c.walkforwardMinTrain, d.walkforwardMinTrain, 8, 1000)),
    zWindow: Math.round(num(c.zWindow, d.zWindow, 20, 1000)),
    maxSymbols: Math.round(num(c.maxSymbols, d.maxSymbols, 4, 200)),
    baseSignals,
  };
}
