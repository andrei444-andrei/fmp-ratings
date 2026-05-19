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
    'Ты — аналитик финансовых рынков.',
    'Тебе дают конкретную дату. Верни главные финансово-значимые события этого дня:',
    'геополитика, монетарная политика (ФРС/ЕЦБ/ЦБ), макро-данные (CPI/NFP/PMI), значимые корпоративные новости,',
    'крахи / шоки, тарифные решения, итоги выборов.',
    'Отвечай строго JSON без пояснений вне его.',
    'Если данных у тебя нет — верни items: [] и summary: "нет уверенных данных".',
  ].join(' ');

  const user = [
    `Дата: ${date}.`,
    tickers ? `Особо интересны активы: ${tickers}.` : '',
    'Сформируй JSON вида:',
    '{ "summary": "<1-2 предложения по дню>", "items": [',
    '  { "title": "<коротко>", "category": "geopolitics|monetary|macro|corporate|crisis|policy|other", "description": "<1-2 предложения>" }',
    '] }',
    'Не более 5 items, отсортируй по важности.',
  ].filter(Boolean).join(' ');

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
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Иногда модели оборачивают в текст. Попытка вытащить { ... }
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
