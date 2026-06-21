import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, aimlChatWithCitations, getAimlSonarModel, type ChatMessage } from '@/lib/aimlapi';
import { buildChatContext } from '@/lib/quantconnect/chat-context';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Роутер «модель решает сама»: дешёвый классификатор определяет, нужен ли вопросу
// живой веб-поиск (мировые/новостные/макро-факты) или ответ по данным портфеля.
async function decideWeb(history: ChatMessage[]): Promise<{ web: boolean; query: string }> {
  const last = history[history.length - 1]?.content || '';
  try {
    const out = await aimlChat({
      messages: [
        {
          role: 'system',
          content:
            'Ты — маршрутизатор вопросов на дашборде квант-стратегий. Реши, нужен ли для ответа ЖИВОЙ ПОИСК В ИНТЕРНЕТЕ. ' +
            'web=true — если вопрос про внешний мир: новости, макроэкономика, события в стране/секторе, что произошло в такую-то дату, ' +
            'текущие котировки/ставки, факты, которых нет в данных бектестов. ' +
            'web=false — если вопрос про сами стратегии портфеля: их доходности, просадки, сделки, сравнение с SPY, статистику. ' +
            'Верни СТРОГО JSON: {"web": true|false, "query": "<краткий поисковый запрос на английском, если web=true, иначе пусто>"}.',
        },
        { role: 'user', content: last.slice(0, 1500) },
      ],
      max_tokens: 80,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const j = JSON.parse(out);
    return { web: !!j.web, query: typeof j.query === 'string' ? j.query : '' };
  } catch {
    return { web: false, query: '' };
  }
}

// POST /api/quantconnect/chat { messages } — ответ AI-ассистента.
// «Модель решает сама»: либо по данным портфеля (бектесты), либо живой веб-поиск
// (Perplexity Sonar) с приоритетом качественных англоязычных финисточников → ответ по-русски + ссылки.
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

    const route = await decideWeb(incoming);

    if (route.web) {
      // Живой веб-поиск: приоритет англоязычным качественным финисточникам, ответ по-русски.
      try {
        const sys: ChatMessage = {
          role: 'system',
          content:
            'Ты — финансовый ассистент с доступом к интернету. Ищи и опирайся на КАЧЕСТВЕННЫЕ англоязычные ' +
            'источники (Bloomberg, Reuters, Financial Times, WSJ, официальные ЦБ/статведомства, биржи). ' +
            'Дай развёрнутый, фактурный ответ ПО-РУССКИ (с числами и датами), Markdown. Если данных мало — честно скажи. ' +
            'Не выдумывай. Ссылки добавлять в текст не нужно — они придут отдельным списком.',
        };
        const { content, citations } = await aimlChatWithCitations({
          model: getAimlSonarModel(),
          messages: [sys, ...incoming],
          max_tokens: 900,
          temperature: 0.2,
        });
        return NextResponse.json({ reply: content, citations, web: true });
      } catch (e: any) {
        // Веб-поиск недоступен — мягкий фолбэк на ответ по данным портфеля.
        await logAppError({ route: '/api/quantconnect/chat', message: 'web-search failed: ' + (e?.message || e) });
      }
    }

    // Ответ по данным портфеля (бектесты).
    const ctx = await buildChatContext().catch(() => 'Данные портфеля недоступны.');
    const system: ChatMessage = {
      role: 'system',
      content:
        'Ты — ассистент на странице «Аналитика алгоритмов»: помогаешь понять, что происходит со стратегиями ' +
        'QuantConnect по данным их бектестов. По каждой стратегии в контексте есть: описание, торгуемые ' +
        'инструменты (из кода), статистика бектеста (Sharpe, Sortino, трейды, win-rate и др.), реальная дневная ' +
        'макс. просадка с датами пика/дна, лучший/худший месяц, СДЕЛКИ (ордера) по годам с инструментами, ' +
        'оборотом и примерами, годовая доходность и просадка против SPY. ' +
        'Отвечай по-русски, в Markdown, развёрнуто и по делу. Используй ТОЛЬКО приведённые данные — не выдумывай ' +
        'числа и факты; если чего-то нет — честно скажи. Бенчмарк — SPY.' +
        '\n\n=== ДАННЫЕ ПОРТФЕЛЯ ===\n' + ctx,
    };

    const reply = await aimlChat({ messages: [system, ...incoming], max_tokens: 900, temperature: 0.3 });
    return NextResponse.json({ reply, web: false });
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/chat', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
