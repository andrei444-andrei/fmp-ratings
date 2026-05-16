const BASE_V3 = 'https://financialmodelingprep.com/api/v3';
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
  return fmpGet(`${BASE_V3}/sp500_constituent?apikey=${encodeURIComponent(key)}`);
}

export async function fmpSp500History() {
  const key = getFmpKey();
  return fmpGet(`${BASE_V3}/historical/sp500_constituent?apikey=${encodeURIComponent(key)}`);
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
