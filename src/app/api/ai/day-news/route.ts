import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, getAimlSonarModel } from '@/lib/aimlapi';
import { getCachedNews, setCachedNews } from '@/lib/news-cache';

// POST /api/ai/day-news { date: YYYY-MM-DD, lang?: string }
// Двухшаговый поиск новостей дня:
//   1) Perplexity Sonar — поиск ТОЛЬКО по англоязычным источникам, ответ на английском.
//   2) Обычная модель — перевод title/description на язык браузера.
// Кэшируется в Turso (news_day_cache, source=perplexity).

function langName(lang: string): string {
  const code = (lang || 'ru').slice(0, 2).toLowerCase();
  const map: Record<string, string> = {
    ru: 'русский', en: 'английский', uk: 'украинский', de: 'немецкий',
    fr: 'французский', es: 'испанский', pt: 'португальский', it: 'итальянский',
    pl: 'польский', tr: 'турецкий', zh: 'китайский', ja: 'японский',
  };
  return map[code] || 'английский';
}

const REFUSAL = /(не удалось|не могу|отсутству|не содерж|нерелевант|без риска|no\s+(reliable|relevant|results)|cannot|could ?n.?t|unable|i'?m sorry|insufficient|no\s+significant)/i;
const RU_SOURCE = /(^|\.)ru$|^ru\.|(lenta|ria|tass|rbc|vedomosti|kommersant|interfax|profile|gazeta|iz\.ru|rt\.com|sputnik|mail\.ru)/i;

type NewsItem = { title: string; description: string; category: string; url?: string; source?: string };

function parseItems(raw: string): NewsItem[] {
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  const arr = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  return arr.map((it: any) => {
    const url = typeof it?.url === 'string' && /^https?:\/\//.test(it.url) ? it.url : undefined;
    let host = typeof it?.source === 'string' ? it.source : undefined;
    if (!host && url) { try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {} }
    return {
      title: typeof it?.title === 'string' ? it.title.slice(0, 240) : '',
      description: typeof it?.description === 'string' ? it.description.slice(0, 500) : '',
      category: typeof it?.category === 'string' ? it.category : 'other',
      url, source: host,
    };
  }).filter((x: NewsItem) =>
    x.title && !REFUSAL.test(x.title) && !REFUSAL.test(x.description) &&
    !(x.source && RU_SOURCE.test(x.source))
  );
}

export async function POST(req: NextRequest) {
  let date = '', lang = 'ru', force = false;
  try {
    const j = await req.json();
    date = typeof j?.date === 'string' ? j.date : '';
    lang = typeof j?.lang === 'string' ? j.lang : 'ru';
    force = j?.force === true || j?.force === 1;
  } catch {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD обязателен' }, { status: 400 });
  }
  const lang2 = lang.slice(0, 2).toLowerCase();

  if (!force) {
    try {
      const cached = await getCachedNews(`sonar:${date}:${lang2}`);
      if (cached) return NextResponse.json({ ...cached.payload, cached: true });
    } catch {}
  }

  // ===== Шаг 1: поиск на английском (Perplexity Sonar) =====
  const sysEN = [
    'You are a financial news researcher with live web access.',
    'Find 5-10 major financial/market news items for the given date. Search ONLY English-language outlets:',
    'Reuters, Bloomberg, WSJ, FT, CNBC, MarketWatch, AP. Do NOT use Russian or non-English sources.',
    'What counts: central bank/rate decisions, macro releases (CPI/NFP/PMI/GDP), big earnings & guidance,',
    'M&A/IPO, geopolitics & sanctions, tariffs, large market & commodity moves.',
    'If the exact day is thin, you may include items from the adjacent day (±1).',
    'Return STRICT JSON only, in ENGLISH:',
    '{"items":[{"title":"...","description":"<1-2 sentences with figures/names>","category":"geopolitics|monetary|macro|corporate|crisis|policy|other","url":"https://<direct article link>","source":"domain"}]}',
    'url must be a direct article link (not homepage/calendar/quote page). 5-10 distinct items.',
    'If after a real search there is genuinely no significant news, return {"items":[]}.',
    'No explanations, apologies or refusals as items, and nothing outside JSON.',
  ].join('\n');

  let rawEN: string;
  try {
    rawEN = await aimlChat({
      messages: [
        { role: 'system', content: sysEN },
        { role: 'user', content: `Collect financial news for ${date} (YYYY-MM-DD). JSON only.` },
      ],
      model: getAimlSonarModel(),
      temperature: 0.2,
      max_tokens: 2500,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Sonar: ${e.message}` }, { status: 502 });
  }

  let items = parseItems(rawEN);

  // ===== Шаг 2: перевод на язык браузера (если не английский) =====
  if (items.length && lang2 !== 'en') {
    try {
      const toTranslate = items.map((it, i) => ({ i, title: it.title, description: it.description }));
      const sysTr = [
        `Переведи финансовые новости на ${langName(lang)} язык.`,
        'Сохрани смысл, цифры, имена и тикеры. Верни СТРОГО JSON того же формата с теми же индексами i.',
        'Формат: {"items":[{"i":<число>,"title":"<перевод>","description":"<перевод>"}]}',
        'Никакого текста вне JSON.',
      ].join('\n');
      const rawTr = await aimlChat({
        messages: [
          { role: 'system', content: sysTr },
          { role: 'user', content: JSON.stringify({ items: toTranslate }) },
        ],
        temperature: 0,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });
      let tp: any = null;
      try { tp = JSON.parse(rawTr); } catch {
        const m = rawTr.match(/\{[\s\S]*\}/); if (m) { try { tp = JSON.parse(m[0]); } catch {} }
      }
      const tr = Array.isArray(tp?.items) ? tp.items : [];
      for (const t of tr) {
        const idx = Number(t?.i);
        if (Number.isFinite(idx) && items[idx]) {
          if (typeof t.title === 'string' && t.title.trim()) items[idx].title = t.title.slice(0, 240);
          if (typeof t.description === 'string') items[idx].description = t.description.slice(0, 500);
        }
      }
    } catch { /* перевод не критичен — оставим английский оригинал */ }
  }

  const payload = { date, items, source: 'perplexity' };
  try { await setCachedNews(`sonar:${date}:${lang2}`, 'perplexity', payload); } catch {}
  return NextResponse.json({ ...payload, cached: false });
}
