import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, getAimlSonarModel } from '@/lib/aimlapi';

// POST /api/ai/event-timeline
// body: { description: string, lang?: string }
// Возвращает структуру события на основе живого веб-поиска (Perplexity Sonar):
// { summary: {...}, timeline: [...] }
//
// Sonar делает реальный поиск и возвращает факты со ссылками — без галлюцинаций
// «по памяти». Поиск ведётся по англоязычным источникам, вывод — на языке lang.

const PHASES = ['trigger', 'escalation', 'peak', 'resolution'];

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
  let description = '';
  let lang = 'ru';
  try {
    const j = await req.json();
    description = typeof j?.description === 'string' ? j.description.trim() : '';
    lang = typeof j?.lang === 'string' ? j.lang : 'ru';
  } catch {}
  if (!description) {
    return NextResponse.json({ error: 'description обязателен' }, { status: 400 });
  }

  const outLang = langName(lang);
  const system = [
    'Ты — финансовый исследователь с доступом к веб-поиску.',
    'По описанию рыночного события найди реальные факты и верни СТРОГО один JSON-объект.',
    'Ищи информацию по авторитетным англоязычным источникам (Reuters, Bloomberg, WSJ, FT, регуляторы).',
    `Весь текст в полях title/description/summary выводи на ${outLang} языке.`,
    '',
    'Структура ответа:',
    '{',
    '  "summary": {',
    '    "title": "<краткое название события>",',
    '    "start": "YYYY-MM-DD", "end": "YYYY-MM-DD",',
    '    "scale": <целое 1-5, масштаб влияния на рынок>,',
    '    "resolution": "received" | "none" | "partial",',
    '    "description": "<2-3 предложения сути>",',
    '    "affected_tickers": ["TICKER", ...]  // до 10 биржевых тикеров US-площадок (NYSE/NASDAQ), по убыванию упоминаемости',
    '  },',
    '  "timeline": [',
    '    {',
    '      "phase": "trigger" | "escalation" | "peak" | "resolution",',
    '      "date": "YYYY-MM-DD",',
    '      "title": "<заголовок одной строкой>",',
    '      "description": "<1-2 предложения>",',
    '      "tickers": ["TICKER", ...],',
    '      "sources": ["https://...", ...]',
    '    }',
    '  ]',
    '}',
    '',
    'Правила:',
    '- Только реальные даты и факты из источников. Если точная дата фазы неизвестна — пропусти фазу.',
    '- affected_tickers — ТОЛЬКО валидные биржевые тикеры (например AAPL, SPY, JPM), без названий компаний.',
    '- Для каждой фазы хронологии добавляй хотя бы одну ссылку-источник.',
    '- Структура динамическая: порядок и набор фаз свободные, фаз одного типа может быть несколько',
    '  (например несколько «эскалация» и несколько «пик»). Не обязательно строго триггер→эскалация→пик→развязка.',
    '- Хронология отсортирована по дате (старые → новые). Для крупных событий — до 20 пунктов,',
    '  для небольших достаточно 3-6. Каждый пункт = отдельный значимый шаг.',
    '- Никакого текста вне JSON.',
  ].join('\n');

  let raw: string;
  try {
    // Sonar обычно не поддерживает response_format=json_object — просим JSON в промпте.
    raw = await aimlChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: description },
      ],
      model: getAimlSonarModel(),
      temperature: 0.1,
      max_tokens: 4000,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Sonar: ${e.message}` }, { status: 502 });
  }

  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json({ error: 'Sonar вернул неразборный JSON', raw: raw.slice(0, 800) }, { status: 502 });
  }

  const s = parsed.summary || {};
  const cleanTickers = (arr: any): string[] =>
    (Array.isArray(arr) ? arr : [])
      .map(t => String(t || '').toUpperCase().trim())
      .filter(t => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t))
      .slice(0, 10);

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const summary = {
    title: typeof s.title === 'string' ? s.title.slice(0, 160) : description.slice(0, 160),
    start: dateRe.test(s.start) ? s.start : '',
    end: dateRe.test(s.end) ? s.end : '',
    scale: Math.max(1, Math.min(5, Number(s.scale) || 3)),
    resolution: ['received', 'none', 'partial'].includes(s.resolution) ? s.resolution : 'none',
    description: typeof s.description === 'string' ? s.description.slice(0, 600) : '',
    affected_tickers: cleanTickers(s.affected_tickers),
  };

  const timelineArr = Array.isArray(parsed.timeline) ? parsed.timeline : [];
  const timeline = timelineArr
    .map((e: any) => ({
      phase: PHASES.includes(e?.phase) ? e.phase : 'escalation',
      date: dateRe.test(e?.date) ? e.date : '',
      title: typeof e?.title === 'string' ? e.title.slice(0, 200) : '',
      description: typeof e?.description === 'string' ? e.description.slice(0, 400) : '',
      tickers: cleanTickers(e?.tickers),
      sources: (Array.isArray(e?.sources) ? e.sources : [])
        .map((u: any) => String(u || '').trim())
        .filter((u: string) => /^https?:\/\//.test(u))
        .slice(0, 4),
    }))
    .filter((e: any) => e.date && e.title)
    .sort((a: any, b: any) => a.date.localeCompare(b.date));

  // Подстраховка дат summary по хронологии.
  if (!summary.start && timeline.length) summary.start = timeline[0].date;
  if (!summary.end && timeline.length) summary.end = timeline[timeline.length - 1].date;

  return NextResponse.json({ summary, timeline });
}
