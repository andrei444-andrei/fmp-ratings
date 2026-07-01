const BASE_STABLE = 'https://financialmodelingprep.com/stable';

export function getFmpKey(): string {
  const k = process.env.FMP_API_KEY;
  if (!k) throw new Error('FMP_API_KEY is not set');
  return k;
}

async function fmpGet(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FMP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data && typeof data === 'object' && !Array.isArray(data) && (data['Error Message'] || data['error'])) {
    throw new Error(data['Error Message'] || data['error']);
  }
  return data;
}

export async function fmpSp500Current() {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/sp500-constituent?apikey=${encodeURIComponent(key)}`);
}

export async function fmpSp500History() {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/historical-sp500-constituent?apikey=${encodeURIComponent(key)}`);
}

export async function fmpHistoricalMcap(symbol: string, from: string, to: string) {
  const key = getFmpKey();
  return fmpGet(
    `${BASE_STABLE}/historical-market-capitalization?symbol=${encodeURIComponent(symbol)}` +
    `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(key)}`
  );
}

export async function fmpGrades(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/grades?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Исторический срез counts аналитических рейтингов на разные даты
export async function fmpGradesHistorical(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/grades-historical?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Консенсус целевых цен sell-side: targetHigh/targetLow/targetConsensus/targetMedian.
export async function fmpPriceTargetConsensus(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/price-target-consensus?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Форвардные прогнозы аналитиков (по годам/кварталам): revenue/ebitda/netIncome/eps в вариантах
// Avg/High/Low + число аналитиков (numAnalystsRevenue/numAnalystsEps). date — год отчётности.
export async function fmpAnalystEstimates(symbol: string, period: 'annual' | 'quarter' = 'annual', limit = 12, page = 0) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/analyst-estimates?symbol=${encodeURIComponent(symbol)}&period=${period}&page=${page}&limit=${encodeURIComponent(limit)}&apikey=${encodeURIComponent(key)}`);
}

// Сводка пересмотров таргета: средний целевой уровень и число публикаций за посл. месяц/квартал/год/всё время
// (lastMonthAvgPriceTarget, lastMonthCount, lastQuarter…, lastYear…, allTime…) — прокси моментума пересмотров.
export async function fmpPriceTargetSummary(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/price-target-summary?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Лента новостей по тикеру: symbol, publishedDate, title, publisher/site, text, url, image.
export async function fmpStockNews(symbol: string, limit = 30) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/news/stock?symbols=${encodeURIComponent(symbol)}&limit=${encodeURIComponent(limit)}&apikey=${encodeURIComponent(key)}`);
}

// Отчёт о прибылях (для фундаментала в динамике): revenue/grossProfit/operatingIncome/netIncome/eps.
export async function fmpIncomeStatement(symbol: string, period: 'quarter' | 'annual' = 'quarter', limit = 24) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/income-statement?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${encodeURIComponent(limit)}&apikey=${encodeURIComponent(key)}`);
}

// Финансовые коэффициенты (маржа/оценка/ликвидность во времени): grossProfitMargin, netProfitMargin,
// priceToEarningsRatio, priceToSalesRatio, currentRatio, quickRatio, dividendYield, payoutRatio и т.д.
export async function fmpRatios(symbol: string, period: 'quarter' | 'annual' = 'quarter', limit = 24) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/ratios?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${encodeURIComponent(limit)}&apikey=${encodeURIComponent(key)}`);
}

// TTM-снимок коэффициентов (для сравнения «сейчас» между компаниями): priceToEarningsRatioTTM,
// priceToSalesRatioTTM, grossProfitMarginTTM, netProfitMarginTTM, returnOnEquityTTM, dividendYieldTTM и т.д.
export async function fmpRatiosTtm(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Компании-аналоги (тот же сектор/близкая капитализация). Возвращает список тикеров-пиров.
export async function fmpPeers(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/peers?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Ключевые метрики (в stable-API живут ОТДЕЛЬНО от ratios): returnOnEquity/Assets/InvestedCapital,
// enterpriseValue и EV-мультипликаторы (evToEBITDA/evToSales/evToFreeCashFlow), freeCashFlowYield,
// netDebtToEBITDA, revenuePerShare, bookValuePerShare и т.д. — во времени.
export async function fmpKeyMetrics(symbol: string, period: 'quarter' | 'annual' = 'quarter', limit = 24) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/key-metrics?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${encodeURIComponent(limit)}&apikey=${encodeURIComponent(key)}`);
}

// Историческая дневная цена закрытия (light: symbol, date, price, volume).
// Возвращает массив, обычно отсортирован по убыванию даты.
export async function fmpHistoricalPriceEod(symbol: string, from?: string, to?: string) {
  const key = getFmpKey();
  const params = new URLSearchParams({ symbol, apikey: key });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return fmpGet(`${BASE_STABLE}/historical-price-eod/light?${params.toString()}`);
}

// Дивидендно-скорректированная цена (total return: сплиты + дивиденды) — для бенчмарка.
// Поле adjClose учитывает реинвест дивидендов.
export async function fmpHistoricalPriceEodDividendAdjusted(symbol: string, from?: string, to?: string) {
  const key = getFmpKey();
  const params = new URLSearchParams({ symbol, apikey: key });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return fmpGet(`${BASE_STABLE}/historical-price-eod/dividend-adjusted?${params.toString()}`);
}

// Историческая EPS Surprise: actual vs estimated по квартальным отчётам.
// FMP /stable/earnings возвращает массив отчётов с epsActual/epsEstimated и revenue.
export async function fmpEarnings(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/earnings?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Профиль компании: имя, сектор/индустрия, биржа, цена, market cap, beta,
// 52-недельный диапазон, IPO-дата, описание и т.д.
export async function fmpProfile(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// История дивидендов (date, dividend/adjDividend, yield, frequency).
export async function fmpDividends(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/dividends?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Скринер компаний: фильтры (country, exchange, marketCapMoreThan, isEtf, isActivelyTrading, limit).
// Используется для динамических списков ликвидных акций по стране (модуль /signals).
export async function fmpScreener(params: Record<string, string | number | boolean>) {
  const key = getFmpKey();
  const q = new URLSearchParams({ apikey: key });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return fmpGet(`${BASE_STABLE}/company-screener?${q.toString()}`);
}

// Поиск по ТИКЕРУ (префиксу символа) — для строки поиска.
export async function fmpSearchSymbol(query: string, limit = 12) {
  const key = getFmpKey();
  return fmpGet(
    `${BASE_STABLE}/search-symbol?query=${encodeURIComponent(query)}` +
    `&limit=${limit}&apikey=${encodeURIComponent(key)}`
  );
}

// Поиск по НАЗВАНИЮ компании (search-symbol матчит только тикеры) — дополняет fmpSearchSymbol.
export async function fmpSearchName(query: string, limit = 12) {
  const key = getFmpKey();
  return fmpGet(
    `${BASE_STABLE}/search-name?query=${encodeURIComponent(query)}` +
    `&limit=${limit}&apikey=${encodeURIComponent(key)}`
  );
}

// Ставки казначейства США (кривая доходности). Поля: date, month1/3/6, year1/2/3/5/7/10/20/30.
export async function fmpTreasury(from: string, to: string) {
  const key = getFmpKey();
  return fmpGet(
    `${BASE_STABLE}/treasury-rates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(key)}`
  );
}

// Экономический календарь. Поля: date, country, event, currency, previous, estimate, actual, impact.
export async function fmpEconomicCalendar(from: string, to: string) {
  const key = getFmpKey();
  return fmpGet(
    `${BASE_STABLE}/economic-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(key)}`
  );
}

// Календарь отчётностей. Поля: symbol, date, epsEstimated, epsActual, revenueEstimated, time.
export async function fmpEarningsCalendar(from: string, to: string) {
  const key = getFmpKey();
  return fmpGet(
    `${BASE_STABLE}/earnings-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(key)}`
  );
}

// Текущая котировка (в т.ч. индексы вроде ^VIX). Поля: symbol, price, change, changePercentage.
export async function fmpQuote(symbol: string) {
  const key = getFmpKey();
  return fmpGet(`${BASE_STABLE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
}

// Пакетные котировки для многих символов разом (near-real-time обновление дашборда).
// Поля строки: symbol, price, change, changePercentage, timestamp. Чанкуем по 50.
export async function fmpBatchQuote(symbols: string[]) {
  const key = getFmpKey();
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()))].filter(Boolean);
  const out: any[] = [];
  const CHUNK = 50;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const part = uniq.slice(i, i + CHUNK);
    const data = await fmpGet(`${BASE_STABLE}/batch-quote?symbols=${encodeURIComponent(part.join(','))}&apikey=${encodeURIComponent(key)}`);
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}
