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

// Поиск тикера по подстроке (symbol, name, exchange) — для строки поиска.
export async function fmpSearchSymbol(query: string, limit = 12) {
  const key = getFmpKey();
  return fmpGet(
    `${BASE_STABLE}/search-symbol?query=${encodeURIComponent(query)}` +
    `&limit=${limit}&apikey=${encodeURIComponent(key)}`
  );
}
