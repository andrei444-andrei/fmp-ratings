import { NextRequest, NextResponse } from 'next/server';
import { aimlChatWithCitations, getAimlSonarModel, type ChatMessage } from '@/lib/aimlapi';
import { siCacheGet, siCacheSet } from '@/lib/superinvestor/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/ticker/<symbol>/ai { messages?: [{role,content}], name?, lang? }
//
// Пустой messages → summary компании в стиле Bloomberg DES (кэшируется).
// Непустой → ответ на вопрос в контексте компании и предыдущей переписки.
// Источник — Perplexity Sonar (живой веб + источники) через aimlapi.

function langName(lang: string): string {
  const code = (lang || 'ru').slice(0, 2).toLowerCase();
  const map: Record<string, string> = {
    ru: 'русском', en: 'английском', uk: 'украинском', de: 'немецком',
    fr: 'французском', es: 'испанском', pt: 'португальском', it: 'итальянском',
    pl: 'польском', tr: 'турецком', zh: 'китайском', ja: 'японском',
  };
  return map[code] || 'английском';
}

// Промт-каркас в стиле Bloomberg Company Description (DES).
function bloombergPrompt(company: string, lang: string): string {
  return [
    `Найди и составь краткое summary публичной компании ${company} в стиле Bloomberg Company Description (DES).`,
    `Пиши на ${langName(lang)} языке; названия сегментов и финансовые термины можно оставлять на английском.`,
    ``,
    `Структурируй ответ РОВНО этими разделами. Каждый заголовок — отдельной строкой, ТОЧНО в таком виде (английские названия), без markdown, без символов # и *:`,
    `Company overview — основной бизнес, ключевые продукты/услуги, бизнес-модель, основные сегменты выручки.`,
    `Sector & industry — сектор, индустрия и подиндустрия, если доступно.`,
    `Geography — где зарегистрирована, штаб-квартира, основные рынки.`,
    `Revenue drivers — что главным образом двигает выручку (продукты, подписки, комиссии, реклама, лицензии, hardware/software, transaction volume, AUM и т.д.).`,
    `Customers — основные клиенты (consumers, enterprises, SMBs, governments, financial institutions, developers и т.д.).`,
    `Competitive position — рыночная позиция, ключевые конкуренты, преимущества/риски.`,
    `Key financial snapshot — market cap, revenue TTM или последний fiscal year, EBITDA / operating income / net income, если доступно. ОБЯЗАТЕЛЬНО укажи дату данных.`,
    `Recent developments — 3–5 важных событий за последние 12 месяцев (earnings, guidance, M&A, product launches, regulatory issues, management changes).`,
    `Bloomberg-style summary — один плотный абзац на 100–150 слов в нейтральном стиле DES: без инвестиционных рекомендаций, без маркетинга, только факты.`,
    ``,
    `Требования: используй только надёжные источники (company filings, annual report, IR, SEC, биржевые страницы, Bloomberg/Reuters/Yahoo Finance/Nasdaq/MarketWatch). Везде, где есть цифры, опирайся на проверяемые данные с датой. Не давай buy/sell/hold рекомендаций. Если данных нет или они противоречивы — напиши это прямо.`,
  ].join('\n');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await ctx.params;
  const symbol = String(rawSymbol || '').toUpperCase().trim();
  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: 'Некорректный тикер' }, { status: 400 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const lang = (typeof body.lang === 'string' ? body.lang : 'ru').slice(0, 2).toLowerCase();
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : symbol;
  const company = name === symbol ? symbol : `${name} (${symbol})`;
  const history: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    .slice(-12);
  const isSummary = history.length === 0;

  const cacheKey = `tkai|${symbol}|${lang}`;
  if (isSummary) {
    const cached = await siCacheGet<{ answer: string; citations: string[] }>(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const sys = [
    `Ты финансовый аналитик. Пользователь смотрит страницу публичной компании ${company}.`,
    `Отвечай на ${langName(lang)} языке, по делу, простым текстом — без markdown-разметки, символов #, * и таблиц.`,
    `Опирайся на актуальную информацию из веба. Если точных данных нет — скажи об этом прямо, не выдумывай. Без инвестиционных рекомендаций.`,
  ].join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: sys }];
  if (isSummary) {
    messages.push({ role: 'user', content: bloombergPrompt(company, lang) });
  } else {
    messages.push(...history);
  }

  try {
    const { content, citations } = await aimlChatWithCitations({
      messages, model: getAimlSonarModel(), temperature: 0.2,
      max_tokens: isSummary ? 1400 : 800,
    });
    const payload = { answer: content, citations };
    if (isSummary) {
      try { await siCacheSet(cacheKey, new Date().toISOString().slice(0, 10), payload); } catch {}
    }
    return NextResponse.json({ ...payload, cached: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
