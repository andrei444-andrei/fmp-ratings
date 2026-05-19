import { NextRequest, NextResponse } from 'next/server';
import { aimlChat } from '@/lib/ai';

// POST /api/ai/find-events
// body: { query: string, model?: string, limit?: number }
// resp: { events: [{date, title, description?, category?}], usage?, model }
export async function POST(req: NextRequest) {
  try {
    const { query, model, limit } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required (string)' }, { status: 400 });
    }
    const max = Math.max(1, Math.min(50, Number(limit) || 25));

    const system = [
      'Ты — эксперт по финансовой истории и истории фондовых рынков.',
      'Пользователь даёт описание типа интересующих его событий.',
      'Верни СТРОГО валидный JSON-объект формата:',
      '{"events":[{"date":"YYYY-MM-DD","title":"...","description":"...","category":"geopolitics|monetary|crisis|pandemic|policy|earnings|other"}]}',
      'Правила:',
      '- Включай только РЕАЛЬНЫЕ исторические события, которые можно проверить по новостям/Wikipedia.',
      '- date = точная дата старта события (день, когда событие стало рыночным фактом, а не дата объявления). Если событие произошло в нерабочий день — указывай день события (рынок открыт со следующего торгового дня).',
      '- НЕ выдумывай. Если уверенности нет — не включай.',
      '- title — короткий заголовок (до 80 символов).',
      '- description — 1-2 предложения контекста.',
      `- Максимум ${max} событий. Сортировка по дате (старые → новые).`,
      '- Никакого текста вне JSON-объекта.',
    ].join('\n');

    const r = await aimlChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: query },
      ],
      { model: model || 'gpt-4o-mini', temperature: 0.2, jsonObject: true },
    );

    const content: string | undefined = r?.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: 'AI вернул пустой ответ', raw: r }, { status: 502 });
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
    if (!parsed) {
      return NextResponse.json({ error: 'AI вернул невалидный JSON', content }, { status: 502 });
    }

    const arr = Array.isArray(parsed?.events) ? parsed.events
              : Array.isArray(parsed) ? parsed
              : [];
    const events = arr
      .filter((e: any) => e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.title === 'string')
      .map((e: any) => ({
        date: e.date,
        title: String(e.title).slice(0, 200),
        description: e.description ? String(e.description).slice(0, 600) : undefined,
        category: e.category && typeof e.category === 'string' ? e.category : 'other',
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));

    return NextResponse.json({
      events,
      model: r?.model || (model || 'gpt-4o-mini'),
      usage: r?.usage,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
