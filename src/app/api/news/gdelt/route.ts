import { NextRequest, NextResponse } from 'next/server';
import { gdeltSearch, type GdeltArticle } from '@/lib/gdelt';

// POST /api/news/gdelt
// body: { query, yearFrom, yearTo, maxPerYear? }
// Бьём диапазон лет на годовые чанки (artlist max 250 / запрос), идём параллельно,
// дедуп по URL.
export async function POST(req: NextRequest) {
  try {
    const { query, yearFrom, yearTo, maxPerYear } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    const nowYear = new Date().getUTCFullYear();
    const yFrom = Math.max(2015, Math.min(nowYear, Number(yearFrom) || nowYear - 5));
    const yTo = Math.max(yFrom, Math.min(nowYear, Number(yearTo) || nowYear));
    const perYear = Math.max(10, Math.min(250, Number(maxPerYear) || 100));

    const years: number[] = [];
    for (let y = yFrom; y <= yTo; y++) years.push(y);

    const all: GdeltArticle[] = [];
    const errors: string[] = [];

    // Параллельно с лимитом concurrency=3 (GDELT мягкий rate-limit).
    const concurrency = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < years.length) {
        const idx = cursor++;
        const y = years[idx];
        const start = `${y}-01-01`;
        const end = y === nowYear
          ? new Date().toISOString().slice(0, 10)
          : `${y}-12-31`;
        try {
          const arts = await gdeltSearch({
            query,
            startDate: start,
            endDate: end,
            maxRecords: perYear,
            sort: 'hybridrel',
          });
          all.push(...arts);
        } catch (e: any) {
          errors.push(`${y}: ${e.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, years.length) }, () => worker()));

    const seen = new Set<string>();
    const dedup = all.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
    dedup.sort((a, b) => a.seendate.localeCompare(b.seendate));

    return NextResponse.json({
      articles: dedup,
      stats: {
        total: dedup.length,
        years: yTo - yFrom + 1,
        rawTotal: all.length,
      },
      errors: errors.length ? errors : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
