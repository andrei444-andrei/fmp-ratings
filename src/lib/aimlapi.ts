// Клиент к aimlapi.com (OpenAI-совместимый /v1/chat/completions).
// Используется в /api/ai/news для генерации сводки новостей дня.

const BASE = 'https://api.aimlapi.com/v1';

export function getAimlApiKey(): string {
  const k = process.env.AIMLAPI_KEY;
  if (!k) throw new Error('AIMLAPI_KEY is not set');
  return k;
}

// Единая модель для всех AI-запросов. Задаётся через env AIMLAPI_MODEL,
// иначе — gpt-4o-mini. Явный параметр model в вызове перекрывает.
export function getAimlModel(): string {
  return process.env.AIMLAPI_MODEL?.trim() || 'gpt-4o-mini';
}

// Модель Perplexity Sonar (живой веб-поиск с источниками) через aimlapi.
// Перекрывается env AIMLAPI_SONAR_MODEL.
export function getAimlSonarModel(): string {
  return process.env.AIMLAPI_SONAR_MODEL?.trim() || 'perplexity/sonar';
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
  const body: any = {
    model: opts.model || getAimlModel(),
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 600,
  };
  if (opts.response_format) body.response_format = opts.response_format;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${key}`,
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
  if (typeof content !== 'string') {
    throw new Error('aimlapi: пустой ответ');
  }
  return content;
}
