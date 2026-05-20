import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, getAimlModel } from '@/lib/aimlapi';

// POST /api/ai/events-search
// body: { system, user, model?, temperature?, maxTokens? }
// Возвращает: { events: [{date,title,description,category}], raw, summary? }
//
// Тонкая обёртка: промпт целиком приходит с клиента (отладка), мы только
// вызываем модель в JSON-режиме и пытаемся распарсить массив событий.
export async function POST(req: NextRequest) {
  try {
    const j = await req.json();
    const system = typeof j?.system === 'string' ? j.system : '';
    const user = typeof j?.user === 'string' ? j.user : '';
    if (!user.trim() && !system.trim()) {
      return NextResponse.json({ error: 'system или user промпт обязателен' }, { status: 400 });
    }
    const model = typeof j?.model === 'string' && j.model.trim() ? j.model.trim() : undefined;
    const temperature = Number.isFinite(j?.temperature) ? Number(j.temperature) : 0.2;
    const maxTokens = Number.isFinite(j?.maxTokens) ? Number(j.maxTokens) : 2000;

    const raw = await aimlChat({
      messages: [
        ...(system.trim() ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: user },
      ],
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }
    if (!parsed) {
      return NextResponse.json({ error: 'не удалось распарсить JSON из ответа', raw }, { status: 502 });
    }

    // Ищем массив событий в любом разумном месте ответа.
    let arr: any[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const knownKeys = ['events', 'items', 'results', 'data', 'list'];
      for (const k of knownKeys) {
        if (Array.isArray(parsed[k])) { arr = parsed[k]; break; }
      }
      // Фолбэк: первое значение-массив объектов в корне.
      if (!arr.length) {
        for (const v of Object.values(parsed)) {
          if (Array.isArray(v) && v.length && typeof v[0] === 'object') { arr = v as any[]; break; }
        }
      }
    }
    const events = arr.map((e: any) => ({
      date: typeof e?.date === 'string' ? e.date : '',
      title: typeof e?.title === 'string' ? e.title : '',
      description: typeof e?.description === 'string' ? e.description : '',
      category: typeof e?.category === 'string' ? e.category : 'other',
    })).filter((e: any) => e.title || e.date);

    return NextResponse.json({
      events,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      raw,
      model: model || getAimlModel(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
