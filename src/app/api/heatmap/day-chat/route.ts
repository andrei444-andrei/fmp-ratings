import { NextRequest, NextResponse } from 'next/server';
import { aimlChatWithCitations, getAimlSonarModel, type ChatMessage } from '@/lib/aimlapi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/heatmap/day-chat { date, news?, messages: [{role,content}], lang? }
//
// AI-чат в контексте конкретного торгового дня. В системный промпт передаём
// дату и новости дня; затем — переписка пользователя. Источник — Perplexity
// Sonar (живой веб + источники) через aimlapi.

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
  let body: any = {};
  try { body = await req.json(); } catch {}

  const date = typeof body.date === 'string' ? body.date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Некорректная дата' }, { status: 400 });
  }
  const lang = (typeof body.lang === 'string' ? body.lang : 'ru').slice(0, 2).toLowerCase();
  const news = typeof body.news === 'string' ? body.news.slice(0, 6000) : '';
  const history: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    .slice(-12);

  if (!history.length) {
    return NextResponse.json({ error: 'Пустой запрос' }, { status: 400 });
  }

  const sys = [
    `Ты финансовый аналитик. Пользователь изучает рыночный день ${date} на хитмапе доходностей ETF.`,
    news
      ? `Контекст — новости этого дня:\n${news}`
      : `Новости этого дня не подгружены — опирайся на актуальную информацию из веба по дате ${date}.`,
    `Отвечай на ${langName(lang)} языке, по делу, простым текстом короткими абзацами — без markdown-разметки, заголовков и таблиц.`,
    `Все вопросы рассматривай в контексте дня ${date}. Опирайся на новости выше и актуальный веб. Если данных нет — скажи прямо, не выдумывай.`,
  ].join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: sys }, ...history];

  try {
    const { content, citations } = await aimlChatWithCitations({
      messages, model: getAimlSonarModel(), temperature: 0.3, max_tokens: 800,
    });
    return NextResponse.json({ answer: content, citations });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
