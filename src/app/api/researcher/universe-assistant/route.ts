import { aimlChat, friendlyAimlError, type ChatMessage } from '@/lib/aimlapi';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// AI-ассистент подбора ВСЕЛЕННОЙ тикеров: ведёт диалог по теме/критериям и отдельно отдаёт список
// тикеров (для выбора и добавления в корзину). Реальность тикеров проверяется при расчёте панели.

function systemPrompt(): string {
  return [
    'Ты — ассистент по подбору вселенной тикеров для скринера (ETF и акции, биржи США).',
    'Пользователь описывает тему/критерии (сектор, регион, стиль, размер, тренд) — ты помогаешь собрать список.',
    'Предпочитай ЛИКВИДНЫЕ ETF и крупные акции с тикерами, торгуемыми в США (NYSE/Nasdaq).',
    '',
    'Правила:',
    '- Отвечай кратко, по-русски; если нужно — уточни критерии.',
    '- Когда предлагаешь набор — верни тикеры списком в поле tickers (от 3 до 40, ЗАГЛАВНЫМИ).',
    '- Используй настоящие биржевые тикеры США (например SPY, QQQ, XLK, EWJ, GLD, AAPL, NVDA).',
    '- Формат ответа — СТРОГО валидный JSON без markdown: {"reply":"<текст>","tickers":["AAA","BBB"]}',
    '  tickers = [] если в этом сообщении ты не предлагаешь конкретный список (например, уточняешь).',
  ].join('\n');
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const history: ChatMessage[] = (Array.isArray(b?.messages) ? b.messages : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    if (!history.length) return Response.json({ error: 'Пустой запрос.' }, { status: 400 });

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt() }, ...history];
    let content: string;
    try {
      content = await aimlChat({ messages, response_format: { type: 'json_object' }, max_tokens: 500, temperature: 0.3 });
    } catch (e) {
      return Response.json({ error: friendlyAimlError(e) }, { status: 502 });
    }

    let reply = content; let tickers: string[] = [];
    try {
      const out = JSON.parse(content);
      if (typeof out?.reply === 'string') reply = out.reply;
      if (Array.isArray(out?.tickers)) {
        const raw: string[] = out.tickers.map((t: any) => String(t).toUpperCase().trim()).filter((t: string) => /^[A-Z0-9.\-]{1,6}$/.test(t));
        tickers = [...new Set(raw)].slice(0, 40);
      }
    } catch { /* не JSON — отдаём текст */ }

    return Response.json({ reply, tickers });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/universe-assistant', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
