import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, getAimlModel } from '@/lib/aimlapi';

// POST /api/ai/events-search
// body: { system, user, model?, temperature?, maxTokens? }
// Возвращает: { events: [{date,title,description,category}], raw, summary?, truncated? }
//
// Тонкая обёртка: промпт целиком приходит с клиента (отладка), мы только
// вызываем модель в JSON-режиме и пытаемся распарсить массив событий.

// Извлекает все сбалансированные {...}-объекты на любом уровне вложенности.
// Спасает события из ОБРЕЗАННОГО (по max_tokens) JSON: все объекты, успевшие
// закрыться до обрыва, парсятся независимо.
function extractAllObjects(raw: string): any[] {
  const out: any[] = [];
  const stack: number[] = [];
  let inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push(i);
    else if (c === '}') {
      const s = stack.pop();
      if (s != null) {
        try {
          const o = JSON.parse(raw.slice(s, i + 1));
          if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o);
        } catch { /* незакрытый/битый объект — пропускаем */ }
      }
    }
  }
  return out;
}

function normalizeEvents(arr: any[]): { date: string; title: string; description: string; category: string }[] {
  return arr.map((e: any) => ({
    date: typeof e?.date === 'string' ? e.date : '',
    title: typeof e?.title === 'string' ? e.title : '',
    description: typeof e?.description === 'string' ? e.description : '',
    category: typeof e?.category === 'string' ? e.category : 'other',
  })).filter((e) => e.title && e.date);
}

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
    const maxTokens = Number.isFinite(j?.maxTokens) ? Number(j.maxTokens) : 4000;

    const messages = [
      ...(system.trim() ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user' as const, content: user },
    ];
    let raw: string;
    try {
      raw = await aimlChat({
        messages, model, temperature, max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      });
    } catch (e: any) {
      if (/response_format|json|not\s+support|400/i.test(e?.message || '')) {
        raw = await aimlChat({ messages, model, temperature, max_tokens: maxTokens });
      } else {
        throw e;
      }
    }

    let parsed: any = null;
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    let events = [] as ReturnType<typeof normalizeEvents>;
    let truncated = false;

    if (parsed) {
      let arr: any[] = [];
      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const knownKeys = ['events', 'items', 'results', 'data', 'list'];
        for (const k of knownKeys) {
          if (Array.isArray(parsed[k])) { arr = parsed[k]; break; }
        }
        if (!arr.length) {
          for (const v of Object.values(parsed)) {
            if (Array.isArray(v) && v.length && typeof v[0] === 'object') { arr = v as any[]; break; }
          }
        }
      }
      events = normalizeEvents(arr);
    }

    // Если строгий парс не дал событий (битый/обрезанный JSON) — спасаем объекты.
    if (!events.length) {
      const salvaged = normalizeEvents(extractAllObjects(raw));
      if (salvaged.length) {
        events = salvaged;
        truncated = !parsed; // если корневой JSON не распарсился — почти наверняка обрыв по лимиту
      }
    }

    if (!events.length) {
      return NextResponse.json({ error: 'не удалось распарсить JSON из ответа', raw }, { status: 502 });
    }

    return NextResponse.json({
      events,
      summary: parsed && typeof parsed.summary === 'string' ? parsed.summary : undefined,
      raw,
      truncated,
      model: model || getAimlModel(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
