import { NextRequest, NextResponse } from 'next/server';
import { marketauxSearch } from '@/lib/marketaux';
import {
  getCachedMonthArticles, setCachedMonthArticles,
  getApiUsage, incApiUsage,
} from '@/lib/news-cache';

// GET /api/events/month-news?month=YYYY-MM[&tickers=SPY,QQQ][&force=1]
// Возвращает top статей за месяц по relevance_score (Marketaux).
// Используется клиентом /heatmap для пакетного поиска важных событий.
// Кэшируется в news_month_cache (key = month + tickers).

const DEFAULT_CAP = 8000;
const PER_MONTH_LIMIT = 30;

function monthRange(month: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  if (m < 1 || m > 12) return null;
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function normalizeTickers(s: string): string {
  return s.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean).sort().join(',');
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  const tickers = normalizeTickers(url.searchParams.get('tickers') || '');
  const force = url.searchParams.get('force') === '1';

  const range = monthRange(month || '');
  if (!range) return NextResponse.json({ error: 'month=YYYY-MM is required' }, { status: 400 });

  const tickersKey = tickers || '_';

  // 1) Кэш
  if (!force) {
    try {
      const cached = await getCachedMonthArticles(month!, tickersKey);
      if (cached) {
        return NextResponse.json({
          month, source: cached.source, cached: true,
          articles: cached.articles, count: cached.articles.length,
        });
      }
    } catch { /* кэш недоступен — продолжаем */ }
  }

  // 2) Marketaux
  const apiToken = process.env.MARKETAUX_KEY;
  if (!apiToken) {
    return NextResponse.json({ error: 'MARKETAUX_KEY не задан' }, { status: 503 });
  }
  const cap = Number(process.env.MARKETAUX_MONTHLY_CAP || DEFAULT_CAP);
  try {
    const used = await getApiUsage('marketaux').catch(() => 0);
    if (used >= cap) {
      return NextResponse.json({
        error: `Marketaux месячный лимит исчерпан (${used}/${cap}). Подожди до следующего месяца или подними cap.`,
      }, { status: 429 });
    }
  } catch { /* счётчик недоступен */ }

  try {
    const arts = await marketauxSearch({
      apiToken,
      dateFrom: range.from,
      dateTo: range.to,
      language: 'en',
      limit: PER_MONTH_LIMIT,
      sort: 'relevance_score',
      sortOrder: 'desc',
      symbols: tickers || undefined,
      filterEntities: !!tickers,
    });
    await incApiUsage('marketaux').catch(() => {});

    const articles = arts.map(a => ({
      date: a.publishedAt,
      title: a.title,
      domain: a.source,
      url: a.url,
      sentiment: a.sentiment,
    }));

    try { await setCachedMonthArticles(month!, tickersKey, 'marketaux', articles); } catch {}

    return NextResponse.json({
      month, source: 'marketaux', cached: false,
      articles, count: articles.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Marketaux: ${e.message}` }, { status: 500 });
  }
}
