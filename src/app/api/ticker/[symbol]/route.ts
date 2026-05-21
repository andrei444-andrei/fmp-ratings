import { NextRequest, NextResponse } from 'next/server';
import {
  fmpProfile, fmpHistoricalPriceEod, fmpEarnings, fmpDividends,
} from '@/lib/fmp';
import { buildChartAndKpis, rangeFrom, type PriceMap } from '@/lib/ticker/compute';
import { MARKET_EVENTS, EVENT_COLORS, normalizeCategory } from '@/lib/market-events';
import { siCacheGet, siCacheSet } from '@/lib/superinvestor/cache';
import type {
  RangeKey, TickerProfile, EarningEvent, DividendEvent, MarketEv, TickerData,
} from '@/lib/ticker/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/ticker/<symbol>?benchmark=SPY&range=2010
// Возвращает профиль, график доходности vs бенчмарк, KPI и события.

const RANGE_SET = new Set<RangeKey>(['1y', '3y', '5y', '10y', '2010', 'max']);

function toPriceMap(data: any, from: string, to: string): PriceMap {
  const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
  const map: PriceMap = {};
  for (const r of arr) {
    if (r && typeof r.date === 'string' && typeof r.price === 'number') {
      if (r.date >= from && r.date <= to) map[r.date] = r.price;
    }
  }
  return map;
}

function parseProfile(data: any, symbol: string): TickerProfile | null {
  const p = Array.isArray(data) ? data[0] : data;
  if (!p || typeof p !== 'object') return null;
  const num = (v: any) => (typeof v === 'number' ? v : v != null && isFinite(Number(v)) ? Number(v) : undefined);
  return {
    symbol: String(p.symbol || symbol).toUpperCase(),
    name: String(p.companyName || p.name || symbol),
    sector: p.sector || undefined,
    industry: p.industry || undefined,
    exchange: p.exchange || p.exchangeShortName || undefined,
    currency: p.currency || undefined,
    country: p.country || undefined,
    price: num(p.price),
    change: num(p.change),
    changePct: num(p.changePercentage ?? p.changesPercentage),
    marketCap: num(p.marketCap),
    beta: num(p.beta),
    lastDividend: num(p.lastDividend),
    range52: p.range || undefined,
    volume: num(p.volume),
    avgVolume: num(p.averageVolume ?? p.avgVolume),
    employees: num(p.fullTimeEmployees),
    ceo: p.ceo || undefined,
    website: p.website || undefined,
    ipoDate: p.ipoDate || undefined,
    description: p.description || undefined,
    image: p.image || undefined,
    isEtf: Boolean(p.isEtf),
  };
}

function parseEarnings(data: any, from: string, to: string): EarningEvent[] {
  if (!Array.isArray(data)) return [];
  const out: EarningEvent[] = [];
  for (const e of data) {
    if (!e || typeof e.date !== 'string') continue;
    if (e.date < from || e.date > to) continue;
    const epsActual = typeof e.epsActual === 'number' ? e.epsActual : null;
    const epsEst = typeof e.epsEstimated === 'number' ? e.epsEstimated : null;
    const revActual = typeof e.revenueActual === 'number' ? e.revenueActual : null;
    const revEst = typeof e.revenueEstimated === 'number' ? e.revenueEstimated : null;
    const surprisePct = epsActual != null && epsEst != null && epsEst !== 0
      ? ((epsActual - epsEst) / Math.abs(epsEst)) * 100 : null;
    out.push({ date: e.date, epsActual, epsEst, revActual, revEst, surprisePct });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
}

function parseDividends(data: any, from: string, to: string): DividendEvent[] {
  if (!Array.isArray(data)) return [];
  const out: DividendEvent[] = [];
  for (const d of data) {
    if (!d || typeof d.date !== 'string') continue;
    if (d.date < from || d.date > to) continue;
    const amount = typeof d.adjDividend === 'number' ? d.adjDividend
      : typeof d.dividend === 'number' ? d.dividend : null;
    if (amount == null) continue;
    out.push({ date: d.date, amount, yield: typeof d.yield === 'number' ? d.yield : null });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
}

function marketWithin(from: string, to: string): MarketEv[] {
  return MARKET_EVENTS
    .filter(e => e.date >= from && e.date <= to)
    .map(e => {
      const cat = normalizeCategory(e.category);
      return { date: e.date, title: e.title, category: cat, color: EVENT_COLORS[cat] };
    });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await ctx.params;
  const symbol = String(rawSymbol || '').toUpperCase().trim();
  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: 'Некорректный тикер' }, { status: 400 });
  }
  const url = new URL(req.url);
  const benchmark = (url.searchParams.get('benchmark') || 'SPY').toUpperCase().slice(0, 12);
  const rangeRaw = (url.searchParams.get('range') || '2010') as RangeKey;
  const range: RangeKey = RANGE_SET.has(rangeRaw) ? rangeRaw : '2010';

  const today = new Date().toISOString().slice(0, 10);
  const from = rangeFrom(range);

  const cacheKey = `tk|${symbol}|${benchmark}|${range}`;
  const cached = await siCacheGet<TickerData>(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  try {
    const [profileRes, symRes, benchRes, earnRes, divRes] = await Promise.allSettled([
      fmpProfile(symbol),
      fmpHistoricalPriceEod(symbol, from, today),
      fmpHistoricalPriceEod(benchmark, from, today),
      fmpEarnings(symbol),
      fmpDividends(symbol),
    ]);

    if (symRes.status !== 'fulfilled') {
      const reason: any = (symRes as PromiseRejectedResult).reason;
      throw new Error(reason?.message || 'не удалось загрузить цены');
    }
    const symPrices = toPriceMap(symRes.value, from, today);
    if (!Object.keys(symPrices).length) {
      return NextResponse.json({ error: `Нет ценовой истории для ${symbol}` }, { status: 404 });
    }
    const benchPrices = benchRes.status === 'fulfilled' ? toPriceMap(benchRes.value, from, today) : {};

    const built = buildChartAndKpis(symPrices, benchPrices, from);
    if (!built) {
      return NextResponse.json({ error: 'Недостаточно данных за период' }, { status: 404 });
    }

    const profile = profileRes.status === 'fulfilled' ? parseProfile(profileRes.value, symbol) : null;
    const earnings = earnRes.status === 'fulfilled'
      ? parseEarnings(earnRes.value, built.window.from, built.window.to) : [];
    const dividends = divRes.status === 'fulfilled'
      ? parseDividends(divRes.value, built.window.from, built.window.to) : [];
    const market = marketWithin(built.window.from, built.window.to);

    const payload: TickerData = {
      symbol,
      benchmark,
      range,
      window: { from: built.window.from, to: built.window.to, inception: profile?.ipoDate || null },
      profile,
      chart: built.chart,
      kpis: built.kpis,
      events: { earnings, dividends, market },
    };

    try { await siCacheSet(cacheKey, today, payload); } catch { /* кэш необязателен */ }
    return NextResponse.json({ ...payload, cached: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
