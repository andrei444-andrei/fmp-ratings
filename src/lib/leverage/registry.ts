// Реестр известных рядов плеча для Sprint 1: FRED + CFTC + FINRA.
// UI и ingest опираются на эти определения, чтобы знать сегмент, лаг, overlay и т.д.

export type SeriesDef = {
  id: string;
  source: 'fred' | 'finra' | 'cftc';
  segment: string;
  label: string;
  unit: string;
  metric: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  lagNote: string;
  indexSymbol?: string;
  higherIsRisk: boolean;
};

export const SEGMENT_LABELS: Record<string, string> = {
  us_equities: 'US Equities',
  futures: 'Futures / Options (COT)',
  macro: 'Macro / Credit',
};

// FRED-ряды. Тянутся через FRED API (нужен FRED_API_KEY).
export const FRED_SERIES: SeriesDef[] = [
  {
    id: 'fred:BOGZ1FL663067003Q',
    source: 'fred',
    segment: 'us_equities',
    label: 'Broker-Dealer Receivables (margin loans proxy)',
    unit: 'USD mln',
    metric: 'broker_dealer_receivables',
    frequency: 'quarterly',
    lagNote: '~1 квартал',
    indexSymbol: '^GSPC',
    higherIsRisk: true,
  },
  {
    id: 'fred:TCMDO',
    source: 'fred',
    segment: 'macro',
    label: 'Total Credit Market Debt',
    unit: 'USD mln',
    metric: 'total_credit_market_debt',
    frequency: 'quarterly',
    lagNote: '~1 квартал',
    higherIsRisk: true,
  },
  {
    // Долларовая капитализация рынка США (Z.1) — знаменатель для margin debt / market cap.
    id: 'fred:NCBEILQ027S',
    source: 'fred',
    segment: 'macro',
    label: 'US Corporate Equities Market Value (FRED)',
    unit: 'USD mln',
    metric: 'market_cap',
    frequency: 'quarterly',
    lagNote: '~1 квартал',
    higherIsRisk: false,
  },
];

// CFTC Commitments of Traders (legacy futures-only, Socrata 6dca-aqww).
// where — фильтр по market_and_exchange_names. Метрика: net non-commercial как % open interest.
export type CftcMarketDef = {
  code: string;       // ES, NQ, CL, GC, EUR
  label: string;
  where: string;      // SoQL LIKE по UPPER(market_and_exchange_names)
};

export const CFTC_MARKETS: CftcMarketDef[] = [
  { code: 'ES', label: 'E-mini S&P 500', where: "%E-MINI S&P 500%" },
  { code: 'NQ', label: 'E-mini Nasdaq-100', where: "%NASDAQ-100%MINI%" },
  { code: 'CL', label: 'Crude Oil (WTI)', where: "%CRUDE OIL, LIGHT SWEET%" },
  { code: 'GC', label: 'Gold', where: "%GOLD - COMMODITY EXCHANGE%" },
  { code: 'EUR', label: 'Euro FX', where: "%EURO FX%" },
];

const CFTC_INDEX_SYMBOL: Record<string, string | undefined> = {
  ES: '^GSPC',
  NQ: '^IXIC',
  CL: 'CLUSD',
  GC: 'GCUSD',
  EUR: 'EURUSD',
};

export function cftcSeriesDef(m: CftcMarketDef): SeriesDef {
  return {
    id: `cftc:${m.code}:net_pct_oi`,
    source: 'cftc',
    segment: 'futures',
    label: `${m.label} — net non-commercial % OI`,
    unit: '% OI',
    metric: 'net_pct_oi',
    frequency: 'weekly',
    lagNote: '~3 дня (отчёт за вторник, публикация в пятницу)',
    indexSymbol: CFTC_INDEX_SYMBOL[m.code],
    higherIsRisk: true,
  };
}

// FINRA Margin Statistics (ручной/полуавтоматический CSV-импорт).
export const FINRA_SERIES: Record<string, SeriesDef> = {
  margin_debt: {
    id: 'finra:margin_debt',
    source: 'finra',
    segment: 'us_equities',
    label: 'FINRA Margin Debt (debit balances)',
    unit: 'USD mln',
    metric: 'margin_debt',
    frequency: 'monthly',
    lagNote: '~3–5 недель',
    indexSymbol: '^GSPC',
    higherIsRisk: true,
  },
  free_credit: {
    id: 'finra:free_credit',
    source: 'finra',
    segment: 'us_equities',
    label: 'FINRA Free Credit Balances',
    unit: 'USD mln',
    metric: 'free_credit',
    frequency: 'monthly',
    lagNote: '~3–5 недель',
    indexSymbol: '^GSPC',
    higherIsRisk: false,
  },
};

export function allKnownSeries(): SeriesDef[] {
  return [
    ...FRED_SERIES,
    ...CFTC_MARKETS.map(cftcSeriesDef),
    ...Object.values(FINRA_SERIES),
  ];
}
