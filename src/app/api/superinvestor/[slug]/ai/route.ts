import { NextRequest, NextResponse } from 'next/server';
import { getInvestorBySlugAsync } from '@/lib/superinvestor/investors-store';
import { aimlChatWithCitations, getAimlSonarModel, type ChatMessage } from '@/lib/aimlapi';
import { siCacheGet, siCacheSet } from '@/lib/superinvestor/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/superinvestor/<slug>/ai { messages?: [{role,content}], lang? }
//
// Пустой messages → генерируем краткое summary об инвесторе (кэшируется).
// Непустой → отвечаем на вопрос в контексте инвестора и предыдущей переписки.
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const investor = await getInvestorBySlugAsync(slug);
  if (!investor) return NextResponse.json({ error: 'Инвестор не найден' }, { status: 404 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const lang = (typeof body.lang === 'string' ? body.lang : 'ru').slice(0, 2).toLowerCase();
  const history: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    .slice(-12);
  const isSummary = history.length === 0;

  const cacheKey = `aisum|${slug}|${lang}`;
  if (isSummary) {
    const cached = await siCacheGet<{ answer: string; citations: string[] }>(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const sys = [
    `Ты финансовый аналитик. Пользователь смотрит профиль инвестора ${investor.name} (${investor.fund}, подаёт форму 13F в SEC).`,
    `Отвечай на ${langName(lang)} языке, по делу, простым текстом короткими абзацами — без markdown-разметки, заголовков и таблиц.`,
    `Опирайся на актуальную информацию из веба. Если точных данных нет — скажи об этом прямо, не выдумывай.`,
  ].join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: sys }];
  if (isSummary) {
    messages.push({
      role: 'user',
      content: `Дай краткое summary об инвесторе ${investor.name} (${investor.fund}): кто это, инвестиционный стиль и философия, самые известные сделки/ставки, ориентировочный размер и текущий фокус портфеля. 4–7 предложений.`,
    });
  } else {
    messages.push(...history);
  }

  try {
    const { content, citations } = await aimlChatWithCitations({
      messages, model: getAimlSonarModel(), temperature: 0.3, max_tokens: 800,
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
