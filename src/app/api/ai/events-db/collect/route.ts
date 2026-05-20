import { NextRequest, NextResponse } from 'next/server';
import { aimlChat, getAimlModel } from '@/lib/aimlapi';
import { insertEvents, type DbEvent, type EventTranslation } from '@/lib/events-db';

// POST /api/ai/events-db/collect
// body: { system, user, model?, temperature?, maxTokens?, langs? }
// Один батч (обычно — один квартал): вызывает AI (промпт английский → события
// на английском), парсит (со спасением из обрезанного JSON), переводит на
// языки из langs (по умолчанию en,ru) и записывает в БД с дедупом.
// Возвращает { found, inserted, events, langs }.

const LANG_NAMES: Record<string, string> = {
  en: 'English', ru: 'Russian', de: 'German', fr: 'French', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', uk: 'Ukrainian',
  pl: 'Polish', tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', ko: 'Korean',
};
function langName(code: string): string { return LANG_NAMES[code.toLowerCase()] || code; }

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
        } catch {}
      }
    }
  }
  return out;
}

function normalize(arr: any[]): DbEvent[] {
  return arr.map((e: any) => ({
    date: typeof e?.date === 'string' ? e.date : '',
    title: typeof e?.title === 'string' ? e.title : '',
    description: typeof e?.description === 'string' ? e.description : '',
    category: typeof e?.category === 'string' ? e.category : 'other',
    source: typeof e?.source === 'string' ? e.source : undefined,
  })).filter(e => e.date && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
}

// Переводит title+description набора событий на целевой язык одним вызовом.
// Возвращает массив той же длины/порядка; при сбое — пустой (фолбэк на оригинал).
async function translateBatch(
  events: { title: string; description?: string }[],
  targetLang: string,
  model: string | undefined,
): Promise<EventTranslation[]> {
  if (!events.length) return [];
  const sys = [
    `You are a professional translator. Translate each item's "title" and "description" into ${langName(targetLang)}.`,
    'Preserve ALL facts, numbers, names, dates, tickers exactly. Do not add, remove or reorder items.',
    'Keep the same array length and order as the input.',
    'Reply STRICTLY as JSON: { "items": [ { "title": "...", "description": "..." } ] } with nothing outside it.',
  ].join('\n');
  const user = JSON.stringify({ items: events.map(e => ({ title: e.title, description: e.description || '' })) });
  let raw: string;
  try {
    raw = await aimlChat({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      model, temperature: 0.1, max_tokens: 8000, response_format: { type: 'json_object' },
    });
  } catch (e: any) {
    if (/response_format|json|not\s+support|400/i.test(e?.message || '')) {
      raw = await aimlChat({
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        model, temperature: 0.1, max_tokens: 8000,
      });
    } else throw e;
  }
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  const arr = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  return arr.map((x: any) => ({
    title: typeof x?.title === 'string' ? x.title : '',
    description: typeof x?.description === 'string' ? x.description : '',
  }));
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
    // Языки хранения. Базовый (язык промпта) — английский.
    const langs: string[] = Array.isArray(j?.langs)
      ? Array.from(new Set(j.langs.map((s: any) => String(s).toLowerCase().trim()).filter(Boolean)))
      : ['en', 'ru'];

    const messages = [
      ...(system.trim() ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user' as const, content: user },
    ];
    let raw: string;
    try {
      raw = await aimlChat({ messages, model, temperature, max_tokens: maxTokens, response_format: { type: 'json_object' } });
    } catch (e: any) {
      if (/response_format|json|not\s+support|400/i.test(e?.message || '')) {
        raw = await aimlChat({ messages, model, temperature, max_tokens: maxTokens });
      } else throw e;
    }

    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    let events: DbEvent[] = [];
    if (parsed) {
      let arr: any[] = [];
      if (Array.isArray(parsed)) arr = parsed;
      else if (parsed && typeof parsed === 'object') {
        for (const k of ['events', 'items', 'results', 'data', 'list']) {
          if (Array.isArray(parsed[k])) { arr = parsed[k]; break; }
        }
        if (!arr.length) {
          for (const v of Object.values(parsed)) {
            if (Array.isArray(v) && v.length && typeof v[0] === 'object') { arr = v as any[]; break; }
          }
        }
      }
      events = normalize(arr);
    }
    if (!events.length) events = normalize(extractAllObjects(raw));

    // Переводы: базовый язык — английский (en) из оригинальных title/description.
    // Для остальных языков из langs — отдельный AI-перевод батчем.
    if (events.length) {
      for (const e of events) {
        e.translations = { en: { title: e.title, description: e.description || '' } };
      }
      for (const lang of langs) {
        if (lang === 'en') continue;
        try {
          const tr = await translateBatch(
            events.map(e => ({ title: e.title, description: e.description })), lang, model,
          );
          events.forEach((e, i) => {
            const t = tr[i];
            if (t && t.title) e.translations![lang] = { title: t.title, description: t.description || '' };
          });
        } catch { /* перевод не удался — язык просто отсутствует, фолбэк на en */ }
      }
    }

    const inserted = await insertEvents(events);
    return NextResponse.json({
      found: events.length,
      inserted,
      events,
      langs,
      model: model || getAimlModel(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
