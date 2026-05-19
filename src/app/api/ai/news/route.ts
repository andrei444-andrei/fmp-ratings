import { NextRequest, NextResponse } from 'next/server';
import { aimlChat } from '@/lib/aimlapi';
import { marketauxSearch, type MarketauxArticle } from '@/lib/marketaux';
import { getCachedNews, setCachedNews, getApiUsage, incApiUsage } from '@/lib/news-cache';

// GET /api/ai/news?date=YYYY-MM-DD[&tickers=SPY,QQQ][&force=1]
//
// Источники:
//   1) кэш в Turso по date — мгновенный ответ, 0 внешних вызовов
//   2) Marketaux (требует MARKETAUX_KEY; счётчик месячного расхода < MARKETAUX_MONTHLY_CAP)
// Затем — AI выбирает 3-5 значимых из реальных заголовков.
//
// При successful запросе результат пишется в кэш (бессрочно).

const DEFAULT_CAP = 8000;

type NewsItem = {
  title: string;
  category: string;
  description: string;
  source?: string;
  url?: string;
};

type RawArticle = {
  title: string;
  date: string;       // YYYY-MM-DD
  domain: string;
  url: string;
};

async function fetchFromMarketaux(date: string, tickers: string): Promise<RawArticle[]> {
  const apiToken = process.env.MARKETAUX_KEY!;
  const arts: MarketauxArticle[] = await marketauxSearch({
    apiToken,
    date,
    language: 'en',
    limit: 50,
    sort: 'published_at',
    sortOrder: 'desc',
    symbols: tickers || undefined,
    filterEntities: !!tickers,
  });
  return arts.map(a => ({
    title: a.title,
    date: a.publishedAt,
    domain: a.source,
    url: a.url,
  }));
}

async function aiSelect(date: string, tickers: string, articles: RawArticle[]):
  Promise<{ summary: string; items: NewsItem[] }> {
  if (!articles.length) return { summary: '', items: [] };

  // Дедуп по (domain + первые 80 символов title).
  const seen = new Set<string>();
  const dedup = articles.filter(a => {
    const k = `${a.domain}|${a.title.slice(0, 80).toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 80);

  const sys = [
    'Ты получаешь список реальных заголовков новостей за конкретную дату.',
    'Твоя задача — ВЫБРАТЬ из них 3-5 главных финансово-значимых событий и описать их на русском.',
    '',
    'СТРОГИЕ ПРАВИЛА:',
    '- Используй ТОЛЬКО информацию из переданных заголовков. Никаких внешних знаний и догадок.',
    '- Если заголовки про одно событие — объедини в одно.',
    '- Если значимых событий нет — верни items: [].',
    '- description = ФАКТ из заголовков (что произошло, кто что сделал, какие цифры), на русском, 1-2 предложения.',
    '- НЕ описывай реакцию рынка ("повлияло", "вызвало рост/падение", "инвесторы реагируют"). Реакцию пользователь видит на heatmap.',
    '- Не выдумывай детали, которых нет в заголовках.',
    '',
    'Категории: geopolitics|monetary|macro|corporate|crisis|policy|pandemic|other.',
    'Отвечай строго JSON, без пояснений вне него.',
  ].join('\n');

  const articleList = dedup.map((a, i) =>
    `${i + 1}. [${a.date}] ${a.title}${a.domain ? ` (${a.domain})` : ''}`
  ).join('\n');

  const user = [
    `Дата: ${date}.`,
    tickers ? `Активы пользователя (контекст, не для описания их реакции): ${tickers}.` : '',
    `Заголовки (${dedup.length}):`,
    articleList,
    '',
    'Верни JSON: { "summary": "<1 предложение о главном факте дня>",',
    '  "items": [ { "title": "<короткий заголовок на русском с фактом>",',
    '              "category": "geopolitics|monetary|macro|corporate|crisis|policy|pandemic|other",',
    '              "description": "<1-2 предложения с конкретикой из заголовков>",',
    '              "source_idx": <номер исходного заголовка из списка, 1-based> } ] }',
    'Не более 5 items.',
  ].filter(Boolean).join('\n');

  const raw = await aimlChat({
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 1200,
  });
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) try { parsed = JSON.parse(m[0]); } catch {}
  }
  if (!parsed) return { summary: '', items: [] };

  const BAN = /(может\s+повлия|оказа(л[оа]|ло|ли)\s+влиян|вызва(л[оа]|ло|ли)\s+(беспокой|обеспокоен|рост|падени)|инвестор[ыа]\s+(пересматрив|реагир|отыграл)|ожидается\s+реакц|может\s+изменить\s+ожидан|влияни[ея]\s+на\s+(индекс|рын|фондов)|реакци[яи]\s+рынк|на\s+фоне\s+(рост|падени)|отыграл)/i;
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: NewsItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it.title !== 'string' || !it.title.trim()) continue;
    const desc = typeof it.description === 'string' ? it.description : '';
    if (BAN.test(desc) || BAN.test(it.title)) continue;
    const idx = Number(it.source_idx);
    const src = Number.isFinite(idx) && idx >= 1 && idx <= dedup.length ? dedup[idx - 1] : null;
    items.push({
      title: it.title.slice(0, 200),
      category: typeof it.category === 'string' ? it.category : 'other',
      description: desc.slice(0, 600),
      source: src?.domain,
      url: src?.url,
    });
  }
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 400) : '',
    items,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const tickers = url.searchParams.get('tickers') || '';
  const force = url.searchParams.get('force') === '1';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD is required' }, { status: 400 });
  }

  // 1) Кэш
  if (!force) {
    try {
      const cached = await getCachedNews(date);
      if (cached) {
        return NextResponse.json({ ...cached.payload, source: cached.source, cached: true });
      }
    } catch { /* кэш недоступен — продолжим */ }
  }

  // 2) Источник — Marketaux (единственный).
  if (!process.env.MARKETAUX_KEY) {
    return NextResponse.json({
      error: 'MARKETAUX_KEY не задан в окружении. Добавь переменную в Vercel и сделай Redeploy.',
    }, { status: 503 });
  }
  const cap = Number(process.env.MARKETAUX_MONTHLY_CAP || DEFAULT_CAP);
  const used = await getApiUsage('marketaux').catch(() => 0);
  if (used >= cap) {
    return NextResponse.json({
      error: `Marketaux месячный лимит исчерпан (${used}/${cap}). Подожди до следующего месяца или подними MARKETAUX_MONTHLY_CAP.`,
    }, { status: 429 });
  }

  let articles: RawArticle[] = [];
  try {
    articles = await fetchFromMarketaux(date, tickers);
    await incApiUsage('marketaux').catch(() => {});
  } catch (e: any) {
    return NextResponse.json({ error: `Marketaux: ${e.message}` }, { status: 502 });
  }

  if (!articles.length) {
    const payload = {
      date,
      summary: 'Marketaux не вернул статей за эту дату.',
      items: [],
      stats: { count: 0 },
    };
    // Кэшируем пустой результат, чтобы не дёргать API повторно для тех же дат.
    try { await setCachedNews(date, 'marketaux', payload); } catch {}
    return NextResponse.json({ ...payload, source: 'marketaux', cached: false });
  }

  // 3) AI кластеризация
  let ai: { summary: string; items: NewsItem[] };
  try {
    ai = await aiSelect(date, tickers, articles);
  } catch (e: any) {
    return NextResponse.json({
      error: `AI: ${e.message}`,
      stats: { count: articles.length },
    }, { status: 500 });
  }

  const payload = {
    date,
    summary: ai.summary,
    items: ai.items,
    stats: { count: articles.length, kept: ai.items.length },
  };

  // 4) Кэш
  try { await setCachedNews(date, 'marketaux', payload); } catch { /* не критично */ }

  return NextResponse.json({ ...payload, source: 'marketaux', cached: false });
}
