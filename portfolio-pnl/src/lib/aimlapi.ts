// Клиент к aimlapi.com — OpenAI-совместимый /v1/chat/completions.
// Ключ: https://aimlapi.com/app/keys

const BASE = 'https://api.aimlapi.com/v1';

export function getAimlApiKey(): string {
  const k = process.env.AIMLAPI_KEY;
  if (!k) throw new Error('AIMLAPI_KEY is not set');
  return k;
}

export function getAimlModel(): string {
  return process.env.AIMLAPI_MODEL?.trim() || 'gpt-4o-mini';
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function aimlChat(opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}): Promise<string> {
  const key = getAimlApiKey();
  const body: Record<string, unknown> = {
    model: opts.model || getAimlModel(),
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.max_tokens ?? 2000,
  };
  if (opts.response_format) body.response_format = opts.response_format;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`aimlapi ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('aimlapi: пустой ответ');
  return content;
}

// Достаёт первый валидный JSON-объект/массив из текста ответа модели,
// даже если он обёрнут в ```json ... ``` или сопровождается пояснениями.
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const trimmed = candidate.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Спасаем из обрезанного/окружённого мусором ответа: ищем первый { или [.
    const start = trimmed.search(/[[{]/);
    if (start === -1) throw new Error('AI: JSON не найден в ответе');
    const open = trimmed[start];
    const close = open === '[' ? ']' : '}';
    const end = trimmed.lastIndexOf(close);
    if (end <= start) throw new Error('AI: не удалось выделить JSON');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}
