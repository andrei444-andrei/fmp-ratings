import { NextRequest, NextResponse } from 'next/server';
import { marketauxSearch } from '@/lib/marketaux';

// GET /api/marketaux/domains?days=14&limit=100[&search=...][&symbols=...][&countries=...]
//
// Эмпирически собирает домены, которые реально приходят в ТВОЁМ тарифе:
// пробегает по N последним дням, тянет статьи и агрегирует частоту source (domain).
// Возвращает: { sampledDates, totalArticles, domains: [{domain, count}], errors? }
export async function GET(req: NextRequest) {
  if (!process.env.MARKETAUX_KEY) {
    return NextResponse.json({ error: 'MARKETAUX_KEY не задан в окружении.' }, { status: 503 });
  }
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 14));
  const limit = Math.max(10, Math.min(100, Number(url.searchParams.get('limit')) || 100));
  const search = url.searchParams.get('search') || undefined;
  const symbols = url.searchParams.get('symbols') || undefined;
  const countries = url.searchParams.get('countries') || undefined;
  const stepStr = url.searchParams.get('step');
  const step = Math.max(1, Math.min(30, Number(stepStr) || 1)); // шаг по дням (для разрежения выборки)

  const apiToken = process.env.MARKETAUX_KEY;
  const counts: Record<string, number> = {};
  const sampledDates: string[] = [];
  const errors: string[] = [];
  let totalArticles = 0;

  const today = new Date();
  for (let i = 0; i < days; i += step) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    sampledDates.push(iso);
    try {
      const arts = await marketauxSearch({
        apiToken,
        date: iso,
        language: 'en',
        limit,
        sort: 'published_at',
        sortOrder: 'desc',
        search,
        symbols,
        countries,
      });
      totalArticles += arts.length;
      for (const a of arts) {
        const dom = (a.source || '').toLowerCase().trim();
        if (!dom) continue;
        counts[dom] = (counts[dom] || 0) + 1;
      }
    } catch (e: any) {
      errors.push(`${iso}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 120));
  }

  const domains = Object.entries(counts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    sampledDates,
    sampledCount: sampledDates.length,
    totalArticles,
    uniqueDomains: domains.length,
    domains,
    errors: errors.length ? errors : undefined,
  });
}
