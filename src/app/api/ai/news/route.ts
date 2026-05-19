import { NextRequest, NextResponse } from 'next/server';
import { aimlChat } from '@/lib/aimlapi';

// GET /api/ai/news?date=YYYY-MM-DD[&tickers=SPY,QQQ]
// Возвращает: { date, summary, items: [{title, category, description}] }
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const tickers = url.searchParams.get('tickers') || '';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD is required' }, { status: 400 });
  }

  const sys = [
    'Ты — летописец фактов. Тебе дают конкретную дату. Верни ТОЛЬКО ПРИЧИНЫ:',
    'что конкретно произошло в этот день (или было опубликовано в этот день).',
    '',
    'РАЗРЕШЕНО в title и description:',
    '— конкретные действия людей и стран (кто, что сделал, где)',
    '— конкретные цифры макро-релизов (CPI, NFP, ставка) и их значение',
    '— решения ФРС/ЕЦБ/ЦБ, законы, тарифы, удары, выборы, IPO/M&A',
    '— погибшие, пострадавшие, объёмы, ставки в процентах',
    '',
    'СТРОГО ЗАПРЕЩЕНО:',
    '— упоминать реакцию рынка (рост/падение акций, индексов, нефти, золота, валют, доходностей)',
    '— фразы «настроения инвесторов», «риск-офф», «бегство в защитные активы», «фиксация прибыли»',
    '— любые слова про «вызвало», «привело к», «спровоцировало», «отыграли» — это уже эффект, не причина',
    '',
    'Пользователь сам видит реакцию рынка на heatmap. Ему нужны ФАКТЫ СОБЫТИЙ, а не их интерпретации.',
    'Отвечай строго JSON, без пояснений вне него.',
    'Если данных нет — верни items: [] и summary: "нет уверенных данных".',
  ].join('\n');

  const user = [
    `Дата: ${date}.`,
    tickers ? `Активы пользователя (для понимания контекста, НЕ для описания их реакции): ${tickers}.` : '',
    'JSON-формат:',
    '{ "summary": "<1 предложение о главном событии дня — только факт, без рыночной реакции>",',
    '  "items": [',
    '    { "title": "<конкретный факт: кто что сделал>",',
    '      "category": "geopolitics|monetary|macro|corporate|crisis|policy|pandemic|other",',
    '      "description": "<1-2 предложения с конкретикой: цифры, имена, места, последствия для людей/политики/политики безопасности — НЕ для рынков>" }',
    '  ] }',
    'Не более 5 items, отсортируй по значимости.',
  ].filter(Boolean).join('\n');

  try {
    const raw = await aimlChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 700,
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
    return NextResponse.json({
      date,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      items: Array.isArray(parsed.items) ? parsed.items : [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
