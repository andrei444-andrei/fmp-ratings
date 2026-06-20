// Конфигурация, рыночные модели издержек и нормализация для движка тестирования
// стратегий (/backtest). Чистые данные/типы (без серверных зависимостей) — импортируется
// и на клиенте (страница), и на сервере (роут исполнения). Единый источник правды по
// дефолтам, пресетам издержек и примеру стратегии.

// Модель издержек одного рынка. Все ставки — в б.п. (1 б.п. = 0.01%) от объёма сделки,
// кроме minCommission (в валюте счёта) и borrowAnnualBps (годовая ставка заёма под шорт).
// КАЛИБРОВКА: реалистичные издержки для ЛИКВИДНЫХ бумаг на тарифах Interactive Brokers (а не
// консервативный «worst case»). commissionBps включает биржевые/клиринговые сборы. half-spread и
// slippage — для ликвидных имён (для неликвида их стоит поднять через override). Налоги/гербовые
// сборы — реальные и обязательные (UK stamp 50, FR FTT 30, IT 10, ES 20, HK stamp ~11/стор.,
// IN STT ~12/стор., KR 18 на продажу, TW 30 на продажу, CH ~3.75/стор.). Можно переопределить.
export type MarketCost = {
  label: string;          // человекочитаемое имя рынка
  currency: string;       // валюта котировок (для предупреждения о смешении валют)
  commissionBps: number;  // комиссия брокера + биржа/клиринг, б.п. от объёма (тариф IB)
  minCommission: number;  // минимальная комиссия за сделку (в валюте счёта)
  halfSpreadBps: number;  // половина бид-аск спреда, б.п. (для ликвидных имён)
  slippageBps: number;    // проскальзывание/воздействие на цену, б.п. (для ликвидных имён)
  borrowAnnualBps: number;// годовая ставка заёма бумаги под шорт, б.п. (только для шортов)
  buyTaxBps: number;      // налог/сбор на покупку (напр. UK stamp duty 50, FR/IT/ES FTT)
  sellTaxBps: number;     // налог/сбор на продажу (напр. KR/TW transaction tax, HK stamp)
};

// Пресеты по рынкам — реалистичные издержки IB для ликвидных бумаг. Код рынка определяется по
// суффиксу тикера (см. SUFFIX_TO_MARKET) или явным override; US — без суффикса.
export const MARKET_COSTS: Record<string, MarketCost> = {
  US: { label: 'США (NYSE/Nasdaq)', currency: 'USD', commissionBps: 0.4, minCommission: 0.35, halfSpreadBps: 0.5, slippageBps: 0.6, borrowAnnualBps: 30, buyTaxBps: 0, sellTaxBps: 0.2 },
  JP: { label: 'Япония (TSE)', currency: 'JPY', commissionBps: 5, minCommission: 0.5, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 0, sellTaxBps: 0 },
  UK: { label: 'Великобритания (LSE)', currency: 'GBP', commissionBps: 4, minCommission: 1, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 50, sellTaxBps: 0 },
  DE: { label: 'Германия (XETRA)', currency: 'EUR', commissionBps: 3, minCommission: 1.25, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 0, sellTaxBps: 0 },
  FR: { label: 'Франция (Euronext Paris)', currency: 'EUR', commissionBps: 3, minCommission: 1.25, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 30, sellTaxBps: 0 },
  NL: { label: 'Euronext (AMS/BRU/LIS)', currency: 'EUR', commissionBps: 3, minCommission: 1.25, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 0, sellTaxBps: 0 },
  IT: { label: 'Италия (Borsa Italiana)', currency: 'EUR', commissionBps: 3, minCommission: 1.25, halfSpreadBps: 2, slippageBps: 2, borrowAnnualBps: 60, buyTaxBps: 10, sellTaxBps: 0 },
  ES: { label: 'Испания (BME Madrid)', currency: 'EUR', commissionBps: 3, minCommission: 1.25, halfSpreadBps: 2, slippageBps: 2, borrowAnnualBps: 60, buyTaxBps: 20, sellTaxBps: 0 },
  CH: { label: 'Швейцария (SIX)', currency: 'CHF', commissionBps: 5, minCommission: 1.5, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 3.75, sellTaxBps: 3.75 },
  SE: { label: 'Швеция (Nasdaq Stockholm)', currency: 'SEK', commissionBps: 4, minCommission: 1, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 0, sellTaxBps: 0 },
  HK: { label: 'Гонконг (HKEX)', currency: 'HKD', commissionBps: 5, minCommission: 2.3, halfSpreadBps: 2, slippageBps: 2, borrowAnnualBps: 100, buyTaxBps: 11, sellTaxBps: 11 },
  CA: { label: 'Канада (TSX)', currency: 'CAD', commissionBps: 3, minCommission: 1, halfSpreadBps: 1.5, slippageBps: 1.5, borrowAnnualBps: 50, buyTaxBps: 0, sellTaxBps: 0 },
  AU: { label: 'Австралия (ASX)', currency: 'AUD', commissionBps: 5, minCommission: 3, halfSpreadBps: 2, slippageBps: 2, borrowAnnualBps: 60, buyTaxBps: 0, sellTaxBps: 0 },
  IN: { label: 'Индия (NSE/BSE)', currency: 'INR', commissionBps: 3, minCommission: 1, halfSpreadBps: 3, slippageBps: 3, borrowAnnualBps: 0, buyTaxBps: 12, sellTaxBps: 12 },
  KR: { label: 'Корея (KRX)', currency: 'KRW', commissionBps: 4, minCommission: 1, halfSpreadBps: 2, slippageBps: 2, borrowAnnualBps: 80, buyTaxBps: 0, sellTaxBps: 18 },
  BR: { label: 'Бразилия (B3)', currency: 'BRL', commissionBps: 3, minCommission: 1, halfSpreadBps: 3, slippageBps: 3, borrowAnnualBps: 150, buyTaxBps: 0, sellTaxBps: 0 },
  TW: { label: 'Тайвань (TWSE)', currency: 'TWD', commissionBps: 4, minCommission: 1, halfSpreadBps: 2, slippageBps: 2, borrowAnnualBps: 100, buyTaxBps: 0, sellTaxBps: 30 },
  MX: { label: 'Мексика (BMV)', currency: 'MXN', commissionBps: 4, minCommission: 1, halfSpreadBps: 3, slippageBps: 3, borrowAnnualBps: 150, buyTaxBps: 0, sellTaxBps: 0 },
  PL: { label: 'Польша (GPW)', currency: 'PLN', commissionBps: 6, minCommission: 3, halfSpreadBps: 4, slippageBps: 4, borrowAnnualBps: 200, buyTaxBps: 0, sellTaxBps: 0 },
  generic: { label: 'Прочий рынок (по умолчанию)', currency: 'USD', commissionBps: 8, minCommission: 1, halfSpreadBps: 6, slippageBps: 6, borrowAnnualBps: 150, buyTaxBps: 0, sellTaxBps: 0 },
};

// Суффикс тикера → код рынка (для автоматического выбора модели издержек).
// Зеркалится в движке (engine.ts) — держать синхронным.
// FMP-стиль (WA/T/L/...) и EODHD-стиль (WAR/TSE/LSE/XETRA) суффиксы. Должно быть в синхроне с
// картой SUFFIX в src/lib/backtest/engine.ts.
export const SUFFIX_TO_MARKET: Record<string, string> = {
  WA: 'PL', WAR: 'PL', T: 'JP', TSE: 'JP', L: 'UK', LSE: 'UK',
  HK: 'HK', DE: 'DE', XETRA: 'DE', F: 'DE', PA: 'FR', TO: 'CA', V: 'CA',
  SW: 'CH', AS: 'NL', BR: 'NL', LS: 'NL', MI: 'IT', MC: 'ES', ST: 'SE',
  AX: 'AU', NS: 'IN', NSE: 'IN', BO: 'IN', KS: 'KR', KQ: 'KR', KO: 'KR',
  SA: 'BR', TW: 'TW', TWO: 'TW', MX: 'MX',
};

export type BacktestConfig = {
  universe: string[];        // торгуемые инструменты
  benchmark: string;         // бенчмарк для сравнения (buy & hold), напр. 'SPY'
  start?: string;            // YYYY-MM-DD (опц.)
  end?: string;              // YYYY-MM-DD (опц.)
  initialCapital: number;    // стартовый капитал (в валюте счёта)
  maxLeverage: number;       // макс. валовое плечо (sum |вес| <= maxLeverage); 0 = без лимита
  allowShort: boolean;       // разрешены ли шорты (отрицательные позиции)
  marginRateAnnual: number;  // годовая ставка по дебету маржи (если кэш < 0), доля (0.06 = 6%)
  defaultMarket: string;     // рынок по умолчанию для тикеров без суффикса
  costs: Record<string, MarketCost>; // таблица издержек по рынкам (передаётся в движок)
  marketOverrides: Record<string, string>; // явная привязка тикера к коду рынка
};

// Пример стратегии по умолчанию (лонг/шорт по пересечению цены и SMA). Демонстрирует
// событийный API on_bar(ctx) и шорты. Это обычная строка — её правит пользователь.
export const DEFAULT_STRATEGY = `# Лонг/шорт по тренду: выше SMA — лонг, ниже — шорт.
# Тикеры стратегии задаются ПРЯМО ЗДЕСЬ, в списке UNIVERSE (любые тикеры, доступные в EODHD:
# US без суффикса, Польша .WA/.WAR, Токио .T и т.д.). Движок торгует ИМЕННО этот список.
# ctx даёт ТОЛЬКО прошлое (до текущего бара) — заглянуть в будущее нельзя.
UNIVERSE = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM"]

def initialize(ctx):
    ctx.lookback = 100          # окно SMA (торговые дни)

def on_bar(ctx):
    syms = ctx.symbols
    n = len(syms)
    for s in syms:
        hist = ctx.history(s, ctx.lookback + 1)   # массив close по бар включительно
        if len(hist) < ctx.lookback + 1:
            continue                              # ещё мало истории — пропускаем
        sma = hist[-ctx.lookback:].mean()
        price = hist[-1]
        if price > sma:
            ctx.order_target_percent(s, 1.0 / n)   # лонг равным весом
        else:
            ctx.order_target_percent(s, -0.5 / n)  # шорт половинным весом
`;

export type UniversePreset = { id: string; label: string; tickers: string[] };

// Готовые вселенные для быстрого старта (US-листинг — работают и на синтетике без ключа).
export const UNIVERSE_PRESETS: UniversePreset[] = [
  { id: 'mega', label: 'Крупные акции США', tickers: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM'] },
  { id: 'sector', label: 'Секторные ETF', tickers: ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU'] },
  { id: 'country', label: 'Страновые ETF', tickers: ['EWJ', 'EWG', 'EWU', 'EWQ', 'FXI', 'EWZ', 'INDA', 'EPOL'] },
  { id: 'poland', label: 'Польша (GPW, нужен план FMP)', tickers: ['CDR.WA', 'PKN.WA', 'PKO.WA', 'DNP.WA', 'PZU.WA', 'KGH.WA'] },
];

function num(v: unknown, dflt: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function cleanSymbol(s: string): string {
  return String(s).toUpperCase().trim();
}

// Допускаем суффиксы бирж и ЦИФРОВЫЕ тикеры (Токио 7203.T) — в отличие от /signals,
// где первый символ обязан быть буквой.
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

export function defaultBacktestConfig(): BacktestConfig {
  return {
    universe: UNIVERSE_PRESETS[0].tickers.slice(),
    benchmark: 'SPY',
    initialCapital: 100000,
    maxLeverage: 0,
    allowShort: true,
    marginRateAnnual: 0.06,
    defaultMarket: 'US',
    costs: MARKET_COSTS,
    marketOverrides: {},
  };
}

function normalizeCost(input: unknown, base: MarketCost): MarketCost {
  const c = (input ?? {}) as Partial<MarketCost>;
  return {
    label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : base.label,
    currency: typeof c.currency === 'string' && c.currency.trim() ? c.currency.trim().toUpperCase() : base.currency,
    commissionBps: num(c.commissionBps, base.commissionBps, 0, 1000),
    minCommission: num(c.minCommission, base.minCommission, 0, 1e6),
    halfSpreadBps: num(c.halfSpreadBps, base.halfSpreadBps, 0, 1000),
    slippageBps: num(c.slippageBps, base.slippageBps, 0, 1000),
    borrowAnnualBps: num(c.borrowAnnualBps, base.borrowAnnualBps, 0, 100000),
    buyTaxBps: num(c.buyTaxBps, base.buyTaxBps, 0, 1000),
    sellTaxBps: num(c.sellTaxBps, base.sellTaxBps, 0, 1000),
  };
}

// Приводим присланный с клиента конфиг к безопасному виду (дефолты + клампы).
export function normalizeBacktestConfig(input: unknown): BacktestConfig {
  const d = defaultBacktestConfig();
  const c = (input ?? {}) as Partial<BacktestConfig> & { universe?: unknown; costs?: unknown; marketOverrides?: unknown };

  const benchmark = (typeof c.benchmark === 'string' && c.benchmark.trim() ? c.benchmark : d.benchmark)
    .toUpperCase()
    .trim();

  // Бенчмарк НЕ исключаем из вселенной: стратегия-таймер может торговать тот же тикер, что и бенчмарк
  // (напр. вход/выход из QQQ vs buy & hold QQQ). Вселенную из конфига движок использует как запасную —
  // если в скрипте задан UNIVERSE, приоритет у него.
  const rawUniverse = Array.isArray(c.universe) ? c.universe : d.universe;
  const universe = [
    ...new Set(rawUniverse.map(cleanSymbol).filter((s) => SYMBOL_RE.test(s))),
  ].slice(0, 60);

  // Таблица издержек: дефолтные пресеты + точечные переопределения с клиента.
  const costs: Record<string, MarketCost> = {};
  for (const [k, base] of Object.entries(MARKET_COSTS)) costs[k] = { ...base };
  const inCosts = (c.costs ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(inCosts)) {
    const base = MARKET_COSTS[k] ?? MARKET_COSTS.generic;
    costs[k] = normalizeCost(v, base);
  }

  const overrides: Record<string, string> = {};
  const inOv = (c.marketOverrides ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(inOv)) {
    const sym = cleanSymbol(k);
    const mk = String(v).trim();
    if (SYMBOL_RE.test(sym) && costs[mk]) overrides[sym] = mk;
  }

  const defaultMarket = costs[String(c.defaultMarket ?? d.defaultMarket)] ? String(c.defaultMarket ?? d.defaultMarket) : 'US';

  return {
    universe: universe.length ? universe : d.universe,
    benchmark,
    start: typeof c.start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.start) ? c.start.slice(0, 10) : undefined,
    end: typeof c.end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.end) ? c.end.slice(0, 10) : undefined,
    initialCapital: num(c.initialCapital, d.initialCapital, 100, 1e12),
    maxLeverage: num(c.maxLeverage, d.maxLeverage, 0, 10),
    allowShort: typeof c.allowShort === 'boolean' ? c.allowShort : d.allowShort,
    marginRateAnnual: num(c.marginRateAnnual, d.marginRateAnnual, 0, 1),
    defaultMarket,
    costs,
    marketOverrides: overrides,
  };
}
