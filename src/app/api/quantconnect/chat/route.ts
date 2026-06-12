import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, type ChatMessage } from '@/lib/aimlapi';
import { buildChatContext } from '@/lib/quantconnect/chat-context';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/quantconnect/chat { messages } — ответ AI-ассистента по данным портфеля.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming: ChatMessage[] = Array.isArray(body?.messages)
      ? body.messages
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-12)
      : [];
    if (!incoming.length || incoming[incoming.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'нет вопроса' }, { status: 400 });
    }

    const ctx = await buildChatContext().catch(() => 'Данные портфеля недоступны.');
    const system: ChatMessage = {
      role: 'system',
      content:
        'Ты — ассистент на странице «Аналитика алгоритмов»: помогаешь понять, что происходит со стратегиями ' +
        'QuantConnect по данным их бектестов. Отвечай по-русски, кратко и по делу, в Markdown. Используй ТОЛЬКО ' +
        'приведённые данные портфеля — не выдумывай числа и факты. Если данных не хватает — честно скажи. ' +
        'Бенчмарк — SPY.\n\n=== ДАННЫЕ ПОРТФЕЛЯ ===\n' + ctx,
    };

    const reply = await aimlChat({ messages: [system, ...incoming], max_tokens: 700, temperature: 0.3 });
    return NextResponse.json({ reply });
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/chat', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
