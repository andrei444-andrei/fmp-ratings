import { NextRequest, NextResponse } from 'next/server';
import { fmpHistoricalPriceEod, fmpGrades } from '@/lib/fmp';
import { heatmapCacheKey, getCachedDataset, setCachedDataset } from '@/lib/heatmap-cache';

// GET /api/heatmap/dataset?tickers=SPY,QQQ&from=YYYY-MM-DD&to=YYYY-MM-DD&grades=1[&cacheOnly=1][&force=1]
//
// Возвращает весь датасет для /heatmap разом: { prices, grades, loadedTickers, cached, cachedAt }.
// - cacheOnly=1 — отдать только из кэша (для авто-показа при открытии страницы; без вызовов FMP).
// - force=1 — игнорировать кэш и перезагрузить из FMP.
// Результат кэшируется в Turso по ключу (tickers+from+to+grades).

type PriceRow = { date: string; price: number };
type GradeItem = {
  symbol: string; date: string;
  gradingCompany?: string; previousGrade?: string; newGrade?: string; action?: string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tickers = (url.searchParams.get('tickers') || '')
    .split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  const grades = url.searchParams.get('grades') === '1';
  const cacheOnly = url.searchParams.get('cacheOnly') === '1';
  const force = url.searchParams.get('force') === '1';

  if (!tickers.length || !from || !to) {
    return NextResponse.json({ error: 'tickers, from, to обязательны' }, { status: 400 });
  }

  const key = heatmapCacheKey({ tickers, from, to, grades });

  if (!force) {
    try {
      const cached = await getCachedDataset(key);
      if (cached) {
        return NextResponse.json({ ...cached.payload, cached: true, cachedAt: cached.createdAt });
      }
    } catch { /* кэш недоступен — продолжим */ }
  }

  // Авто-показ при открытии: если в кэше пусто — не ходим в FMP.
  if (cacheOnly) {
    return NextResponse.json({ prices: {}, grades: {}, loadedTickers: [], cached: false, miss: true });
  }

  const prices: Record<string, Record<string, number>> = {};
  const gradesOut: Record<string, Record<string, GradeItem[]>> = {};
  const loadedTickers: string[] = [];
  const errors: string[] = [];

  for (const sym of tickers) {
    try {
      const data = await fmpHistoricalPriceEod(sym, from, to);
      const arr: PriceRow[] = Array.isArray(data) ? data : (data?.historical || []);
      const map: Record<string, number> = {};
      for (const r of arr) {
        if (r && typeof r.date === 'string' && typeof r.price === 'number') {
          if (r.date >= from && r.date <= to) map[r.date] = r.price;
        }
      }
      if (!Object.keys(map).length) { errors.push(`${sym}: нет цен`); continue; }
      prices[sym] = map;
    } catch (e: any) {
      errors.push(`${sym}: ${e.message}`);
      continue;
    }

    if (grades) {
      try {
        const gRes = await fmpGrades(sym);
        if (Array.isArray(gRes)) {
          const byDate: Record<string, GradeItem[]> = {};
          for (const g of gRes as GradeItem[]) {
            if (!g || !g.date) continue;
            if (g.date < from || g.date > to) continue;
            (byDate[g.date] = byDate[g.date] || []).push(g);
          }
          gradesOut[sym] = byDate;
        }
      } catch { /* grades необязательны */ }
    }
    loadedTickers.push(sym);
  }

  const payload = { prices, grades: gradesOut, loadedTickers, errors: errors.length ? errors : undefined };

  if (loadedTickers.length) {
    try { await setCachedDataset(key, to, payload); } catch { /* не критично */ }
  }

  return NextResponse.json({ ...payload, cached: false });
}
