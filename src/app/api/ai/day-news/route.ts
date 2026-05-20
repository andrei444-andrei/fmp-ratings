import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, getAimlSonarModel } from '@/lib/aimlapi';
import { getCachedNews, setCachedNews } from '@/lib/news-cache';

// POST /api/ai/day-news { date: YYYY-MM-DD, lang?: string }
// 5-10 значимых финансовых новостей за день через Perplexity Sonar (живой поиск),
// со ссылками, на языке браузера. Кэшируется в Turso (news_day_cache, source=sonar).

function langName(lang: string): string {
  const code = (lang || 'ru').slice(0, 2).toLowerCase();
  const map: Record<string, string> = {
    ru: 'русском', en: 'английском', uk: 'украинском', de: 'немецком',
    fr: 'французском', es: 'испанском', pt: 'португальском', it: 'итальянском',
    pl: 'польском', tr: 'турецком', zh: 'китайском', ja: 'японском',
  };
  return map[code] || 'английском';
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

  if (!force) {
    try {
      const cached = await getCachedNews(`sonar:${date}:${lang.slice(0, 2)}`);
      if (cached) return NextResponse.json({ ...cached.payload, cached: true });
    } catch {}
  }

  const outLang = langName(lang);
  const system = [
    'Ты — финансовый журналист-ресёрчер с доступом к веб-поиску.',
    'Задача: собрать главные финансовые и рыночные новости за конкретный торговый день.',
    '',
    'Поиск веди ТОЛЬКО на английском и ТОЛЬКО по англоязычным источникам:',
    '- запросы на английском: "<Month DD, YYYY> stock market", "... Fed / ECB / inflation / CPI / jobs / earnings"',
    '- источники: reuters.com, bloomberg.com, wsj.com, ft.com, cnbc.com, marketwatch.com, apnews.com',
    '- ЗАПРЕЩЕНО использовать русскоязычные/локальные источники (домены .ru, ru.*, lenta, ria, tass, rbc,',
    '  vedomosti, kommersant, interfax, profile.ru, euronews ru и т.п.). Только англоязычные оригиналы.',
    '- если на сам день мало — допускается захватить публикации соседнего дня (±1).',
    '',
    'Что считается новостью: решения ЦБ и ставки, макро-релизы (CPI/NFP/PMI/ВВП), отчётности и гайденс',
    'крупных компаний, M&A/IPO, геополитика и санкции, тарифы, крупные движения рынков и сырья.',
    '',
    `Затем ПЕРЕВЕДИ заголовок и описание каждой новости на ${outLang} язык (источник — англоязычный оригинал).`,
    'В поле source оставляй домен англоязычного источника (например reuters.com), url — прямая ссылка на ту же статью.',
    'Формат СТРОГО: {"items":[{"title":"<перевод заголовка>","description":"<перевод 1-2 предложений сути с цифрами/именами>","category":"geopolitics|monetary|macro|corporate|crisis|policy|other","url":"https://<прямая ссылка на статью>","source":"домен"}]}',
    'Требования: 5-10 разных новостей; url — прямая ссылка на материал (не главная, не календарь, не котировки).',
    'Если после реального поиска значимых новостей действительно нет — верни строго {"items":[]}.',
    'Никаких пояснений, извинений и отказов в виде элементов items и вне JSON.',
  ].join('\n');

  let raw: string;
  try {
    raw = await aimlChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Собери новости за ${date} (формат YYYY-MM-DD). Верни только JSON.` },
      ],
      model: getAimlSonarModel(),
      temperature: 0.2,
      max_tokens: 2500,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Sonar: ${e.message}` }, { status: 502 });
  }

  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  const arr = Array.isArray(parsed?.items) ? parsed.items
    : Array.isArray(parsed) ? parsed : [];
  // Sonar иногда вместо пустого списка возвращает текст-отказ как «новость» — отсекаем.
  const REFUSAL = /(не удалось|не могу|не уда[её]тся|отсутству|не содерж|нерелевант|без риска|пуст(ой|ые)\s+результат|no\s+(reliable|relevant|results)|cannot|could ?n.?t|unable|i'?m sorry|insufficient)/i;
  // Только англоязычные источники: отсекаем .ru и известные русскоязычные домены.
  const RU_SOURCE = /(^|\.)ru$|^ru\.|(lenta|ria|tass|rbc|vedomosti|kommersant|interfax|profile|gazeta|iz\.ru|rt\.com|sputnik)/i;
  const items = arr.map((it: any) => {
    const url = typeof it?.url === 'string' && /^https?:\/\//.test(it.url) ? it.url : undefined;
    let host = typeof it?.source === 'string' ? it.source : undefined;
    if (!host && url) { try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {} }
    return {
      title: typeof it?.title === 'string' ? it.title.slice(0, 240) : '',
      description: typeof it?.description === 'string' ? it.description.slice(0, 500) : '',
      category: typeof it?.category === 'string' ? it.category : 'other',
      url, source: host,
    };
  }).filter((x: any) =>
    x.title && !REFUSAL.test(x.title) && !REFUSAL.test(x.description) &&
    !(x.source && RU_SOURCE.test(x.source))
  );

  const payload = { date, items, source: 'perplexity' };
  try { await setCachedNews(`sonar:${date}:${lang.slice(0, 2)}`, 'perplexity', payload); } catch {}
  return NextResponse.json({ ...payload, cached: false });
}
