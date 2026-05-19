import { NextRequest, NextResponse } from 'next/server';
import { aimlChat } from '@/lib/aimlapi';

// GET /api/ai/events-month?month=YYYY-MM[&tickers=SPY,QQQ]
// Возвращает: { month, events: [{date,title,category,description}] }
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  const tickers = url.searchParams.get('tickers') || '';
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month=YYYY-MM is required' }, { status: 400 });
  }

  const sys = [
    'Ты — летописец фактов с календарём событий.',
    'Тебе дают конкретный месяц. Верни 3-5 самых значимых событий месяца с ТОЧНОЙ датой (YYYY-MM-DD).',
    '',
    'Категории и приоритет:',
    '1. geopolitics — войны, удары, перевороты, крупные санкции',
    '2. monetary — решения ФРС / ЕЦБ / БоЯ / ЦБ, изменения ставки, QE/QT',
    '3. macro — ключевые макро-релизы: CPI, NFP, PMI, ВВП, retail sales',
    '4. crisis — банкротства мегакапов, банковские крахи, дефолты',
    '5. policy — выборы, инаугурации, тарифы, ключевые законы',
    '6. corporate — IPO/M&A мегакапов, банкротства крупных компаний',
    '7. pandemic — события пандемии (только для 2020-2022)',
    '',
    'РАЗРЕШЕНО в title и description:',
    '— конкретные факты: кто, что, где, когда, сколько (числа, проценты, имена, страны)',
    '— цифры макро-релизов (CPI 3.2%, NFP +250к, ставка 5.25%)',
    '— реальные последствия для людей/политики/безопасности',
    '',
    'СТРОГО ЗАПРЕЩЕНО:',
    '— упоминать реакцию рынка (рост/падение акций, индексов, нефти, золота, валют, доходностей)',
    '— фразы «движущие рынок», «вызвало рост/падение», «отыграли», «риск-офф», «фиксация прибыли»',
    '— описывать ВЛИЯНИЕ на котировки — пользователь видит это сам на heatmap',
    '',
    'Жёсткие правила:',
    '- Только этот месяц. События других месяцев — игнорировать.',
    '- Только конкретный день, который ты точно помнишь. Если день не уверен — пропусти событие.',
    '- НЕ включать рутинные новости (квартальная отчётность, мелкие апгрейды, пресс-релизы).',
    '- Отвечай строго JSON, без пояснений вне него.',
  ].join('\n');

  const user = [
    `Месяц: ${month}.`,
    tickers ? `Особо интересны активы: ${tickers}.` : '',
    'Формат ответа:',
    '{ "events": [',
    '  { "date": "YYYY-MM-DD", "title": "короткий заголовок", "category": "geopolitics|monetary|crisis|pandemic|policy|macro|corporate|other", "description": "1-2 предложения" }',
    '] }',
    '3-5 событий, отсортированных по значимости.',
  ].filter(Boolean).join(' ');

  try {
    const raw = await aimlChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 900,
    });
    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }
    if (!parsed) {
      return NextResponse.json({ error: 'не удалось распарсить ответ AI', raw }, { status: 502 });
    }
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    // Фильтруем — только реальные даты этого месяца
    const ok = events.filter((e: any) =>
      e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
      e.date.startsWith(month) && typeof e.title === 'string' && e.title.trim().length > 0
    );
    return NextResponse.json({ month, events: ok });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
