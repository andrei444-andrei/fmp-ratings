import { aimlChat, friendlyAimlError, type ChatMessage } from '@/lib/aimlapi';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// AI-ассистент составления формул скринера. Знает DSL и доступные факторы (приходят с клиента),
// ведёт диалог и предлагает готовую формулу в structured JSON. Валидацию формулы делает клиент.

type FactorSpec = { id: string; label: string; periods: number[] };

function systemPrompt(factors: FactorSpec[]): string {
  const list = factors.map((f) => `- ${f.id} (${f.label}): периоды ${f.periods.join(', ')}`).join('\n');
  return [
    'Ты — ассистент по составлению формул (вычисляемых метрик) для скринера ETF/акций. Пользователь описывает',
    'нужную метрику словами — ты помогаешь и предлагаешь формулу на нашем DSL.',
    '',
    'DSL формул:',
    '- Ссылка на фактор: имя[период], например momentum[63], vol[21], xbench[63], xvadj[63], sma_dist[200], rsi[14], dist_ath[0].',
    '- Операторы: + - * / и круглые скобки.',
    '- Функции: avg(...), min(...), max(...), sum(...), abs(x), sqrt(x), log(x), pow(основание, степень), sign(x).',
    '- Значения факторов в процентах/пунктах: моментум/превышение/вола — в %.',
    '',
    'Доступные факторы (используй ТОЛЬКО их и только перечисленные периоды):',
    list,
    '',
    'Смысл некоторых факторов: momentum — доходность за период; vol — годовая волатильность; xbench — превышение',
    'бенчмарка (SPY); xvadj — превышение, скорректированное на волатильность; sma_dist — отклонение от SMA;',
    'dist_ath — расстояние от максимума (0 = исторический ATH); rsi — RSI.',
    '',
    'Правила ответа:',
    '- Отвечай кратко, по-русски.',
    '- Если данных достаточно — предложи конкретную формулу; если нужно уточнение — задай вопрос и formula = null.',
    '- Имя формулы: короткое, латиница/цифры/подчёркивание, НЕ совпадает с именем фактора.',
    '- Используй ТОЛЬКО перечисленные факторы и функции; не выдумывай новые.',
    '- Формат ответа — СТРОГО валидный JSON без markdown: {"reply": "<текст>", "formula": {"name":"<имя>","expr":"<выражение>"}}',
    '  где formula = null, если ты не предлагаешь готовую формулу в этом сообщении.',
  ].join('\n');
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const factors: FactorSpec[] = Array.isArray(b?.factors) ? b.factors : [];
    const history: ChatMessage[] = (Array.isArray(b?.messages) ? b.messages : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    if (!history.length) return Response.json({ error: 'Пустой запрос.' }, { status: 400 });

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(factors) }, ...history];
    let content: string;
    try {
      content = await aimlChat({ messages, response_format: { type: 'json_object' }, max_tokens: 500, temperature: 0.2 });
    } catch (e) {
      return Response.json({ error: friendlyAimlError(e) }, { status: 502 });
    }

    let reply = content, formula: { name: string; expr: string } | null = null;
    try {
      const out = JSON.parse(content);
      if (typeof out?.reply === 'string') reply = out.reply;
      if (out?.formula && typeof out.formula?.name === 'string' && typeof out.formula?.expr === 'string') {
        formula = { name: String(out.formula.name).slice(0, 64), expr: String(out.formula.expr).slice(0, 512) };
      }
    } catch { /* не JSON — отдаём как текст */ }

    return Response.json({ reply, formula });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/formula-assistant', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
