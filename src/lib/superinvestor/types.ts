// Нормализованные типы раздела superinvestor.
// FMP-специфичные поля маппятся в эти типы в fmp13f.ts — компьют-движок
// и страницы работают только с нормализованными структурами.

export type InvestorType = 'value' | 'activist' | 'macro' | 'concentrated' | 'quant';

export const INVESTOR_TYPE_LABEL: Record<InvestorType, string> = {
  value: 'Value',
  activist: 'Activist',
  macro: 'Macro',
  concentrated: 'Concentrated',
  quant: 'Quant',
};

// Запись реестра инвесторов (курируемый список 13F-филеров).
export type Investor = {
  slug: string;   // 'buffett'
  name: string;   // 'Warren Buffett'
  fund: string;   // 'Berkshire Hathaway'
  cik: string;    // '0001067983' (10-значный, с ведущими нулями)
  type: InvestorType;
  blurb?: string; // короткое описание стратегии
};

// Одна позиция 13F внутри квартала.
export type Holding = {
  symbol: string;
  name?: string;
  shares: number;
  value: number;   // рыночная стоимость позиции, USD, на конец квартала
  weight: number;  // доля портфеля 0..1
};

// Снимок холдингов за квартал.
export type QuarterHoldings = {
  period: string;      // '2024Q3'
  quarterEnd: string;  // 'YYYY-MM-DD' конец отчётного квартала
  filingDate: string;  // 'YYYY-MM-DD' дата подачи 13F — точка входа copy-стратегии
  holdings: Holding[];
};

// Компактная матрица цен: общий ось дат + close по символу (null где нет цены).
export type PriceMatrix = {
  dates: string[];                            // отсортированные торговые дни
  series: Record<string, (number | null)[]>;  // symbol -> close по индексу даты
};

// Кривая copy-стратегии vs SPY.
export type EquityCurve = {
  dates: string[];
  copy: number[];            // нормированная стоимость портфеля (старт = 1)
  spy: number[];             // нормированный SPY (старт = 1)
  rebalanceDates: string[];  // даты ребаланса (filing + задержка)
};

// Закрытая сделка (позиция, доведённая до 0 акций).
export type ClosedTrade = {
  symbol: string;
  name?: string;
  openDate: string;
  closeDate: string;
  entryPrice: number;     // средневзвешенная цена входа
  exitPrice: number;
  shares: number;         // макс. размер позиции (для контекста)
  returnPct: number;      // exit/entry - 1
  spyReturnPct: number;   // SPY за то же окно
  alphaPct: number;       // returnPct - spyReturnPct
  holdingDays: number;
  year: number;           // год закрытия (для фильтра)
};

// Открытая позиция с нереализованным P&L.
export type OpenPosition = {
  symbol: string;
  name?: string;
  shares: number;
  weight: number;         // текущая доля портфеля 0..1
  value: number;          // рыночная стоимость, USD (последний 13F)
  avgCost: number;        // средняя цена входа (по копированию филингов)
  lastPrice: number;
  unrealizedPct: number;  // lastPrice/avgCost - 1
  firstSeen: string;      // дата филинга первого появления
  quartersHeld: number;
};

// Ячейка heatmap холдингов (символ × квартал).
export type HoldingsHeatmap = {
  periods: string[];                      // кварталы (старые → новые)
  symbols: string[];                      // строки, упорядочены
  names: Record<string, string>;
  weights: Record<string, (number | null)[]>; // symbol -> вес 0..1 по кварталу (null = не держал)
};

// Метрики-KPI инвестора.
export type Kpis = {
  alphaPct: number;        // совокупная copy-альфа vs SPY за окно
  alphaAnnPct: number;     // годовая альфа
  copyReturnPct: number;   // совокупная доходность copy
  spyReturnPct: number;    // совокупная доходность SPY
  winRatePct: number;      // % прибыльных закрытых сделок
  alphaWinRatePct: number; // % сделок с положительной альфой
  sharpe: number;          // годовой Sharpe copy-стратегии
  maxDrawdownPct: number;  // макс. просадка copy (отрицательное число)
  closedTrades: number;
  openPositions: number;
};

// Конфигурация бэктеста (задержка входа + минимальный вес).
export type BacktestConfig = {
  delayDays: number;   // T+0 / T+1 / T+5 / T+10 (торговые дни)
  minWeight: number;   // 0..1, отсечка по весу позиции
};

export type BacktestResult = {
  config: BacktestConfig;
  curve: EquityCurve;
  finalAlphaPct: number;
  finalCopyPct: number;
  sharpe: number;
  maxDrawdownPct: number;
};

// Полная сводка инвестора (ответ detail-API).
export type InvestorDetail = {
  investor: Investor;
  window: { from: string; to: string };
  aum: number;                  // последняя рыночная стоимость портфеля 13F
  quarters: QuarterHoldings[];
  priceMatrix: PriceMatrix;     // для клиентского пересчёта бэктеста
  equityCurve: EquityCurve;     // T+0 базовая
  kpis: Kpis;
  closedTrades: ClosedTrade[];
  openPositions: OpenPosition[];
  heatmap: HoldingsHeatmap;
  backtest: BacktestResult[];   // T+0/1/5/10 при базовом minWeight
};

// Строка лидерборда.
export type LeaderboardRow = {
  investor: Investor;
  aum: number;
  alphaPct: number;
  alphaAnnPct: number;
  copyReturnPct: number;
  spyReturnPct: number;
  winRatePct: number;
  sharpe: number;
  maxDrawdownPct: number;
  closedTrades: number;
  openPositions: number;
  topHoldings: { symbol: string; weight: number }[];
};
