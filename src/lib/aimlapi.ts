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

export type ChatOpts = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
};

// Полный вариант: возвращает контент И finish_reason (нужно ловить обрезку 'length').
export async function aimlChatMeta(opts: ChatOpts): Promise<{ content: string; finishReason: string | null }> {
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
  const finishReason = data?.choices?.[0]?.finish_reason ?? null;
  return { content, finishReason };
}

export async function aimlChat(opts: ChatOpts): Promise<string> {
  return (await aimlChatMeta(opts)).content;
}

// Как aimlChat, но дополнительно возвращает источники (citations) — для Perplexity Sonar.
export async function aimlChatWithCitations(opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<{ content: string; citations: string[] }> {
  const key = getAimlApiKey();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model || getAimlModel(),
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens ?? 700,
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`aimlapi ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('aimlapi: пустой ответ');
  const raw = Array.isArray(data?.citations) ? data.citations
    : Array.isArray(data?.choices?.[0]?.message?.citations) ? data.choices[0].message.citations
    : [];
  const citations: string[] = raw
    .map((c: any) => (typeof c === 'string' ? c : c?.url))
    .filter((u: any) => typeof u === 'string' && /^https?:\/\//.test(u));
  return { content, citations };
}
