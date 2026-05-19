import { NextRequest, NextResponse } from 'next/server';
import { aimlChat } from '@/lib/aimlapi';

// POST /api/ai/cluster-events
// body: { query: string, articles: [{title, seendate, domain?, url?}], model?, limit? }
// resp: { events: [{date, title, description?, category?}] }
// AI группирует список статей в значимые рыночные события + извлекает точные даты старта.
export async function POST(req: NextRequest) {
  try {
    const { query, articles, model, limit } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    if (!Array.isArray(articles)) {
      return NextResponse.json({ error: 'articles array is required' }, { status: 400 });
    }
    const max = Math.max(1, Math.min(50, Number(limit) || 25));

    // Ограничиваем размер промпта: 250 заголовков с датами хватит для кластеризации.
    const truncated = articles.slice(0, 250).map((a: any) => ({
      d: typeof a.seendate === 'string' ? a.seendate : '',
      t: typeof a.title === 'string' ? a.title.slice(0, 200) : '',
      s: a.domain || '',
    })).filter(a => a.d && a.t);

    if (!truncated.length) {
      return NextResponse.json({ events: [] });
    }

    const system = [
      'Ты — финансовый аналитик. Тебе дают исходный запрос пользователя и список заголовков новостных статей с датами.',
      'Сгруппируй статьи в значимые РЫНОЧНЫЕ события, соответствующие запросу.',
      'Для каждого события:',
      '- date: YYYY-MM-DD — точная дата СТАРТА события (когда событие стало рыночным фактом; обычно — самая ранняя статья в кластере).',
      '- title: короткое название события на русском (до 80 символов).',
      '- description: 1-2 предложения контекста на русском.',
      '- category: одно из geopolitics|monetary|crisis|pandemic|policy|earnings|other.',
      'Правила:',
      '- Несколько статей про одно событие — это ОДНО событие, объединяй.',
      '- НЕ выдумывай события, которых нет в списке статей.',
      '- Пропускай шум, дубликаты, статьи не по теме.',
      `- Максимум ${max} событий. Сортируй по дате (старые → новые).`,
      'Верни СТРОГО JSON: {"events":[{"date":"YYYY-MM-DD","title":"...","description":"...","category":"..."}]}',
      'Никакого текста вне JSON.',
    ].join('\n');

    const articleList = truncated
      .map((a, i) => `${i + 1}. [${a.d}] ${a.t}${a.s ? ` (${a.s})` : ''}`)
      .join('\n');

    const user = [
      `Исходный запрос: ${query}`,
      '',
      `Статьи (${truncated.length}):`,
      articleList,
    ].join('\n');

    const raw = await aimlChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      model: model || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    if (!parsed) {
      return NextResponse.json({ error: 'AI вернул невалидный JSON', raw }, { status: 502 });
    }
    const arr = Array.isArray(parsed?.events) ? parsed.events : [];
    const events = arr
      .filter((e: any) => e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.title === 'string')
      .map((e: any) => ({
        date: e.date,
        title: String(e.title).slice(0, 200),
        description: e.description ? String(e.description).slice(0, 600) : undefined,
        category: typeof e.category === 'string' ? e.category : 'other',
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));

    return NextResponse.json({ events, articleCount: truncated.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
