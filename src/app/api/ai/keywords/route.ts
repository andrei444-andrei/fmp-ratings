import { NextRequest, NextResponse } from 'next/server';
import { aimlChat } from '@/lib/aimlapi';

// POST /api/ai/keywords
// body: { query: string, model?: string }
// resp: { gdeltQuery: string }
// AI преобразует описание (на любом языке) в EN-поисковый запрос к GDELT DOC API.
export async function POST(req: NextRequest) {
  try {
    const { query, model } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const system = [
      'Ты помогаешь искать релевантные статьи в GDELT 2.0 (новостной агрегатор).',
      'По описанию интересующих рыночных событий составь GDELT search query.',
      'Синтаксис GDELT:',
      '- слова через пробел = AND; OR-альтернативы в скобках, например (bank OR lender);',
      '- фразы в двойных кавычках: "interest rate hike";',
      '- операторы: sourcelang:eng, sourcecountry:US, theme:ECON_BANKRUPTCY и т.п.',
      'Правила:',
      '- Запрос строго на английском.',
      '- Используй OR-группы синонимов для широкого охвата.',
      '- Добавляй sourcelang:eng для отсечения нерелевантных языков.',
      '- НЕ включай конкретные даты — для дат есть отдельные параметры.',
      '- Запрос должен быть достаточно широким, чтобы найти много статей, но точным по смыслу.',
      '- Не превышай 400 символов.',
      'Верни СТРОГО JSON: {"query": "<gdelt query>"}',
    ].join('\n');

    const raw = await aimlChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: query },
      ],
      model: model || 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    const q = parsed?.query;
    if (!q || typeof q !== 'string') {
      return NextResponse.json({ error: 'AI не вернул query', raw }, { status: 502 });
    }
    return NextResponse.json({ gdeltQuery: q.slice(0, 500) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
