// Оркестрация: 13F-холдинги (FMP) + цены → компьют-движок → InvestorDetail / LeaderboardRow.
// Всё тяжёлое кэшируется в Turso (si_cache). Серверный модуль (использует FMP-ключ и БД).

import { fmpHistoricalPriceEod } from '@/lib/fmp';
import { fmp13fDates, fmp13fHoldings } from './fmp13f';
import { siCacheGet, siCacheSet } from './cache';
import { getInvestorBySlugAsync } from './investors-store';
import {
  copyEquityCurve, deriveTrades, computeKpis, buildHoldingsHeatmap, runBacktest,
} from './compute';
import type {
  InvestorDetail, LeaderboardRow, PriceMatrix, QuarterHoldings, BacktestConfig,
} from './types';

export const DEFAULT_BACKTEST: BacktestConfig[] = [
  { delayDays: 0, minWeight: 0 },
  { delayDays: 1, minWeight: 0 },
  { delayDays: 5, minWeight: 0 },
  { delayDays: 10, minWeight: 0 },
];

// Версия вычисляемого кэша. Бамп инвалидирует старые detail/row (после фикса формулы):
// старый ключ становится промахом и payload пересчитывается заново.
const CV = 'v2';
export function detailKey(slug: string, win: { from: string; to: string }): string {
  return `detail|${CV}|${slug}|${win.from}|${win.to}`;
}
export function rowKey(slug: string, win: { from: string; to: string }): string {
  return `row|${CV}|${slug}|${win.from}|${win.to}`;
}

export function defaultWindow(years = 3): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// Окно из query: явный from (YYYY или YYYY-MM-DD) либо years (1..20, дефолт 3).
export function resolveWindow(params: URLSearchParams): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const fromRaw = (params.get('from') || '').trim();
  if (fromRaw) {
    const f = /^\d{4}$/.test(fromRaw) ? `${fromRaw}-01-01` : fromRaw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(f) && f >= '2000-01-01' && f < to) return { from: f, to };
  }
  const yp = parseInt(params.get('years') || '3', 10);
  const years = yp >= 1 && yp <= 20 ? yp : 3;
  return defaultWindow(years);
}

// Параллельная загрузка с ограничением конкуренции.
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const cur = i++;
      out[cur] = await fn(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Цены одного символа (кэш по symbol+from+to).
async function getPriceMap(symbol: string, from: string, to: string): Promise<Record<string, number>> {
  const key = `prices|${symbol}|${from}|${to}`;
  const cached = await siCacheGet<Record<string, number>>(key);
  if (cached) return cached;
  const map: Record<string, number> = {};
  try {
    const data = await fmpHistoricalPriceEod(symbol, from, to);
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    for (const r of arr) {
      if (r && typeof r.date === 'string' && typeof r.price === 'number' && r.date >= from && r.date <= to) {
        map[r.date] = r.price;
      }
    }
  } catch { /* нет цен — символ выпадет из расчёта */ }
  if (Object.keys(map).length) await siCacheSet(key, to, map);
  return map;
}

// Матрица цен: ось дат = торговые дни SPY; series по символам.
async function buildPriceMatrix(symbols: string[], from: string, to: string): Promise<PriceMatrix> {
  const uniq = Array.from(new Set(['SPY', ...symbols]));
  const maps = await mapLimit(uniq, 8, s => getPriceMap(s, from, to));
  const bySym: Record<string, Record<string, number>> = {};
  uniq.forEach((s, i) => (bySym[s] = maps[i]));

  const spy = bySym['SPY'] || {};
  const dates = Object.keys(spy).sort();
  const series: Record<string, (number | null)[]> = {};
  for (const s of uniq) {
    const m = bySym[s] || {};
    series[s] = dates.map(d => (m[d] != null ? m[d] : null));
  }
  return { dates, series };
}

// Холдинги одного квартала (кэш по cik+период; прошлые кварталы неизменны).
async function getQuarter(cik: string, year: number, quarter: number): Promise<QuarterHoldings | null> {
  const key = `holdings|${cik}|${year}Q${quarter}`;
  const cached = await siCacheGet<QuarterHoldings>(key);
  if (cached) return cached;
  const q = await fmp13fHoldings(cik, year, quarter);
  if (q) await siCacheSet(key, q.quarterEnd, q);
  return q;
}

// Полная сводка инвестора. Кэшируется целиком (detail|slug|from|to).
export async function buildInvestorDetail(slug: string, win: { from: string; to: string }): Promise<InvestorDetail | null> {
  const investor = await getInvestorBySlugAsync(slug);
  if (!investor) return null;
  const { from, to } = win;

  const cacheKey = detailKey(slug, win);
  const cached = await siCacheGet<InvestorDetail>(cacheKey);
  if (cached) return cached;

  // 1. Доступные кварталы в окне.
  const periods = (await fmp13fDates(investor.cik))
    .filter(p => p.date >= from && p.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!periods.length) return null;

  // 2. Холдинги по кварталам.
  const quartersRaw = await mapLimit(periods, 4, p => getQuarter(investor.cik, p.year, p.quarter));
  const quarters = quartersRaw.filter((q): q is QuarterHoldings => !!q && q.holdings.length > 0)
    .sort((a, b) => a.filingDate.localeCompare(b.filingDate));
  if (!quarters.length) return null;

  // 3. Цены для объединения символов + SPY.
  const symbols = Array.from(new Set(quarters.flatMap(q => q.holdings.map(h => h.symbol))));
  const pm = await buildPriceMatrix(symbols, from, to);

  // 4. Компьют.
  const equityCurve = copyEquityCurve(quarters, pm, { delayDays: 0, minWeight: 0 });
  const { closed, open } = deriveTrades(quarters, pm);
  const kpis = computeKpis(equityCurve, closed, open.length);
  const heatmap = buildHoldingsHeatmap(quarters);
  const backtest = runBacktest(quarters, pm, DEFAULT_BACKTEST);

  const lastQ = quarters[quarters.length - 1];
  const aum = lastQ.holdings.reduce((s, h) => s + h.value, 0);

  const detail: InvestorDetail = {
    investor, window: { from, to }, aum,
    quarters, priceMatrix: pm,
    equityCurve, kpis, closedTrades: closed, openPositions: open, heatmap, backtest,
  };
  await siCacheSet(cacheKey, to, detail);
  return detail;
}

// Строка лидерборда (кэш отдельно — без тяжёлой матрицы цен).
export async function buildLeaderboardRow(slug: string, win: { from: string; to: string }): Promise<LeaderboardRow | null> {
  const key = rowKey(slug, win);
  const cachedRow = await siCacheGet<LeaderboardRow>(key);
  if (cachedRow) return cachedRow;

  const detail = await buildInvestorDetail(slug, win);
  if (!detail) return null;

  const lastQ = detail.quarters[detail.quarters.length - 1];
  const topHoldings = [...lastQ.holdings].sort((a, b) => b.weight - a.weight).slice(0, 5)
    .map(h => ({ symbol: h.symbol, weight: h.weight }));

  const row: LeaderboardRow = {
    investor: detail.investor,
    aum: detail.aum,
    alphaPct: detail.kpis.alphaPct,
    alphaAnnPct: detail.kpis.alphaAnnPct,
    copyReturnPct: detail.kpis.copyReturnPct,
    spyReturnPct: detail.kpis.spyReturnPct,
    winRatePct: detail.kpis.winRatePct,
    sharpe: detail.kpis.sharpe,
    maxDrawdownPct: detail.kpis.maxDrawdownPct,
    closedTrades: detail.kpis.closedTrades,
    openPositions: detail.kpis.openPositions,
    topHoldings,
  };
  await siCacheSet(key, win.to, row);
  return row;
}
