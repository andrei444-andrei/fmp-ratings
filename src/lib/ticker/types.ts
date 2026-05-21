// Общие типы раздела /ticker (client-safe, без серверных импортов).

export type RangeKey = '1y' | '3y' | '5y' | '10y' | '2010' | 'max';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: '1y', label: '1г' },
  { key: '3y', label: '3г' },
  { key: '5y', label: '5л' },
  { key: '10y', label: '10л' },
  { key: '2010', label: 'с 2010' },
  { key: 'max', label: 'Max' },
];

export const BENCHMARKS: { symbol: string; label: string }[] = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq 100' },
  { symbol: 'IWM', label: 'Russell 2000' },
  { symbol: 'DIA', label: 'Dow Jones' },
];

export type TickerProfile = {
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  currency?: string;
  country?: string;
  price?: number;
  change?: number;
  changePct?: number;
  marketCap?: number;
  beta?: number;
  lastDividend?: number;
  range52?: string;
  volume?: number;
  avgVolume?: number;
  employees?: number;
  ceo?: string;
  website?: string;
  ipoDate?: string;
  description?: string;
  image?: string;
  isEtf?: boolean;
};

export type ChartPayload = {
  dates: string[];
  symbolPct: number[];      // накопленная доходность %, ребейз к старту окна
  benchmarkPct: number[];   // то же для бенчмарка
  symbolGrowth: number[];   // рост $1 (для лог-шкалы)
  benchmarkGrowth: number[];
};

export type TickerKpis = {
  totalReturnPct: number;
  benchReturnPct: number;
  alphaPct: number;
  cagrPct: number;
  benchCagrPct: number;
  maxDrawdownPct: number;
  volPct: number;
  best: { date: string; pct: number } | null;
  worst: { date: string; pct: number } | null;
};

export type EarningEvent = {
  date: string;
  epsActual: number | null;
  epsEst: number | null;
  revActual: number | null;
  revEst: number | null;
  surprisePct: number | null;
};

export type DividendEvent = { date: string; amount: number; yield: number | null };
export type MarketEv = { date: string; title: string; category: string; color: string };

export type TickerData = {
  symbol: string;
  benchmark: string;
  range: RangeKey;
  window: { from: string; to: string; inception: string | null };
  profile: TickerProfile | null;
  chart: ChartPayload;
  kpis: TickerKpis;
  events: { earnings: EarningEvent[]; dividends: DividendEvent[]; market: MarketEv[] };
};
