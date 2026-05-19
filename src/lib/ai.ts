// Клиент AIML API (OpenAI-совместимый эндпоинт).
// Ключ берётся из env (AIML_API_KEY), в код не коммитим.

const BASE = 'https://api.aimlapi.com/v1';

export function getAimlKey(): string {
  const k = process.env.AIML_API_KEY;
  if (!k) throw new Error('AIML_API_KEY is not set');
  return k;
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOpts = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonObject?: boolean;
};

export async function aimlChat(messages: ChatMessage[], opts: ChatOpts = {}) {
  const key = getAimlKey();
  const body: any = {
    model: opts.model || 'gpt-4o-mini',
    messages,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonObject) body.response_format = { type: 'json_object' };

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`AIML ${res.status}: ${txt.slice(0, 400)}`);
  }
  return res.json();
}
