// Рыночный терминал — типы данных модуля (см. docs/market-terminal-design.md).
// Вселенная = ДАННЫЕ (BlockDef + InstrumentDef), а не код: добавление блока/инструмента
// не меняет логику расчёта. Метрики — чистые функции от дневных цен getPrices.

// Окна доходности в ТОРГОВЫХ днях (по индексам массива баров, не по календарю).
// 7→5 (торговая неделя) — по рекомендации разведки.
export const RET_WINDOWS = [1, 5, 21, 63, 126, 252] as const;
export type RetWindow = (typeof RET_WINDOWS)[number];

export type InstrumentKind = 'etf' | 'index' | 'stock' | 'proxy';

export type InstrumentDef = {
  symbol: string;
  title: string;
  kind: InstrumentKind;
  /** Валюта котировки. FX-инвариант: для блока стран — только 'USD' (US-листинги ETF). */
  currency: string;
  /** Тонкие/молодые бумаги: показываем, но не включаем в breadth/avgCorr блока. */
  optional?: boolean;
  note?: string;
};

export type BlockType = 'market' | 'sector' | 'metal' | 'basket';
export type BlockLayout = 'table' | 'heatmap';

export type BlockDef = {
  id: string;
  title: string;
  type: BlockType;
  /** Символ бенчмарка для excess/относительной силы ('SPY', 'ACWI', …); '' — нет. */
  benchmark: string;
  /** Символы инструментов (many-to-many: один символ может входить в разные блоки). */
  members: string[];
  layout?: BlockLayout;
};

// Метрики одного инструмента — результат чистых функций от ряда цен.
export type InstrumentMetrics = {
  symbol: string;
  last: number;
  asOf: string; // дата последнего бара (ISO yyyy-mm-dd)
  /** window(торг. дней) → доходность в % (или null, если истории не хватает). */
  returns: Record<number, number | null>;
  mtd: number | null;
  qtd: number | null;
  ytd: number | null;
  vol21: number | null; // annualized, %
  vol63: number | null;
  volRatio: number | null; // vol21/vol63 — ускорение волатильности
  z63: number | null; // z-score дневной доходности (lookback 63д)
  pct52w: number | null; // положение в 52-нед диапазоне, %
  aboveMA50: boolean | null;
  aboveMA200: boolean | null;
  /** Excess vs бенчмарк блока за 63д — заполняется на уровне блока. */
  excess63: number | null;
  spark: number[]; // даунсэмпл ряда цен (~80 точек) для спарклайна
  synthetic?: boolean; // true — данные синтетические (нет ключей), не рыночная картина
};

export type BlockMetrics = {
  breadthMA50: number | null; // % членов выше MA50
  breadthMA200: number | null;
  advancers: number;
  decliners: number;
  composite: number | null; // 0..100 сводный breadth
  avgCorr: number | null; // средняя попарная корреляция 63д
  best: { symbol: string; ret63: number } | null;
  worst: { symbol: string; ret63: number } | null;
};

export type InstrumentCell = { def: InstrumentDef; metrics: InstrumentMetrics | null };
export type OverviewBlock = { def: BlockDef; metrics: BlockMetrics; instruments: InstrumentCell[] };

export type MarketRegime = {
  score: number; // 0 (risk-on) .. 100 (risk-off)
  avgCorr: number | null;
  volRegime: number | null; // vol21/vol252 по бенчмарку
  breadth: number | null; // % вселенной выше MA200
  label: 'risk-on' | 'neutral' | 'risk-off';
};

export type CorrelationMatrix = {
  symbols: string[];
  titles: string[];
  matrix: (number | null)[][]; // попарная корреляция дневных доходностей (63д), диагональ = 1
  window: number;
};

export type MarketOverview = {
  asOf: string;
  blocks: OverviewBlock[];
  regime: MarketRegime;
  correlation: CorrelationMatrix | null;
  synthetic: boolean; // в снапшоте есть синтетика → не показывать как рыночную картину
};
