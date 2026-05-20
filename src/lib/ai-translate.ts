// Батч-перевод title+description событий на целевой язык через AI.
// Используется в /api/ai/events-db/collect и /api/ai/events-db/translate.

import { aimlChat } from '@/lib/aimlapi';

export type EventTr = { title: string; description?: string };

const LANG_NAMES: Record<string, string> = {
  en: 'English', ru: 'Russian', de: 'German', fr: 'French', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', uk: 'Ukrainian',
  pl: 'Polish', tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', ko: 'Korean',
};
export function langName(code: string): string {
  return LANG_NAMES[code.toLowerCase()] || code;
}

export async function translateBatch(
  events: { title: string; description?: string }[],
  targetLang: string,
  model: string | undefined,
): Promise<EventTr[]> {
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
