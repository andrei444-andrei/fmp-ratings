// FMP 13F / institutional-ownership — обёртки stable API + нормализация в наши типы.
// Премиум-эндпоинты FMP. weight в API задан в процентах (3.45 = 3.45%).

import { getFmpKey } from '@/lib/fmp';
import type { Holding, QuarterHoldings } from './types';

const BASE = 'https://financialmodelingprep.com/stable';

async function fmpGet(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FMP ${res.status}: ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  if (data && typeof data === 'object' && !Array.isArray(data) && (data['Error Message'] || data['error'])) {
    throw new Error(data['Error Message'] || data['error']);
  }
  return data;
}

export type Period = { date: string; year: number; quarter: number };
export type HolderRef = { cik: string; name: string };

// Каталог 13F-филеров (cik + name) для поиска по имени. Большой список —
// тянем постранично; кэшируется на уровне роута.
export async function fmp13fList(): Promise<HolderRef[]> {
  const key = getFmpKey();
  const out: HolderRef[] = [];
  for (let page = 0; page < 60; page++) {
    const url = `${BASE}/institutional-ownership/list?page=${page}&limit=1000&apikey=${encodeURIComponent(key)}`;
    const data = await fmpGet(url);
    const arr = Array.isArray(data) ? data : [];
    for (const r of arr) {
      const cik = String(r.cik || '').padStart(10, '0').slice(-10);
      const name = String(r.name || '').trim();
      if (cik && name) out.push({ cik, name });
    }
    if (arr.length < 1000) break;
  }
  return out;
}

// Доступные кварталы 13F для CIK (новые → старые либо как отдаёт FMP).
export async function fmp13fDates(cik: string): Promise<Period[]> {
  const key = getFmpKey();
  const data = await fmpGet(`${BASE}/institutional-ownership/dates?cik=${encodeURIComponent(cik)}&apikey=${encodeURIComponent(key)}`);
  if (!Array.isArray(data)) return [];
  return data
    .map((r: any) => ({ date: String(r.date), year: Number(r.year), quarter: Number(r.quarter) }))
    .filter(p => p.date && p.year && p.quarter);
}

function normalizeRow(r: any): Holding | null {
  const symbol = String(r.symbol || '').trim().toUpperCase();
  if (!symbol) return null;
  // Отсекаем опционы/путы-коллы — копируем только длинные акции.
  const pc = String(r.putCallShare || r.putCall || '').toLowerCase();
  if (pc === 'put' || pc === 'call') return null;
  const shares = Number(r.sharesNumber ?? r.shares ?? 0);
  const value = Number(r.marketValue ?? r.value ?? 0);
  if (!(shares > 0) || !(value > 0)) return null;
  const weightPct = r.weight != null ? Number(r.weight) : null;
  return {
    symbol,
    name: r.securityName || r.nameOfIssuer || undefined,
    shares,
    value,
    weight: weightPct != null && isFinite(weightPct) ? weightPct / 100 : 0, // 0 → пересчитаем ниже
  };
}

// Холдинги одного квартала. Сначала analytics-эндпоинт (есть weight/имена),
// при пустом ответе — сырой extract с пересчётом весов из marketValue.
export async function fmp13fHoldings(cik: string, year: number, quarter: number): Promise<QuarterHoldings | null> {
  const key = getFmpKey();
  const fetchPaged = async (path: string): Promise<any[]> => {
    const rows: any[] = [];
    for (let page = 0; page < 8; page++) {
      const url = `${BASE}/${path}?cik=${encodeURIComponent(cik)}&year=${year}&quarter=${quarter}` +
        `&page=${page}&limit=1000&apikey=${encodeURIComponent(key)}`;
      const data = await fmpGet(url);
      const arr = Array.isArray(data) ? data : [];
      rows.push(...arr);
      if (arr.length < 1000) break;
    }
    return rows;
  };

  let rows: any[] = [];
  try {
    rows = await fetchPaged('institutional-ownership/extract-analytics/holder');
  } catch { /* попробуем сырой extract */ }
  if (!rows.length) {
    try { rows = await fetchPaged('institutional-ownership/extract'); } catch { /* нет данных */ }
  }
  if (!rows.length) return null;

  const filingDate = String(rows[0].filingDate || rows[0].acceptedDate || rows[0].date || '').slice(0, 10);
  const quarterEnd = String(rows[0].date || '').slice(0, 10);

  let holdings = rows.map(normalizeRow).filter((h): h is Holding => !!h);
  // Дедуп по символу (на случай нескольких классов) — суммируем.
  const bySym: Record<string, Holding> = {};
  for (const h of holdings) {
    const e = bySym[h.symbol];
    if (e) { e.shares += h.shares; e.value += h.value; e.weight += h.weight; }
    else bySym[h.symbol] = { ...h };
  }
  holdings = Object.values(bySym);

  // Если weight не пришёл (сырой extract) — считаем из рыночной стоимости.
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const weightSum = holdings.reduce((s, h) => s + h.weight, 0);
  if (weightSum < 0.5 && totalValue > 0) {
    for (const h of holdings) h.weight = h.value / totalValue;
  }

  if (!holdings.length || !filingDate || !quarterEnd) return null;
  return {
    period: `${year}Q${quarter}`,
    quarterEnd,
    filingDate,
    holdings: holdings.sort((a, b) => b.weight - a.weight),
  };
}
