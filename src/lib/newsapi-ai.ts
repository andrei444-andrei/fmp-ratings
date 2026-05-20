// Клиент NewsAPI.ai / Event Registry.
// Документация: https://www.newsapi.ai/documentation
// Auth: apiKey в query.
//
// Ключевая фишка: эндпоинт event/getEvents автокластеризует статьи в СОБЫТИЯ
// с totalArticleCount (встроенный индикатор значимости) — то что нужно для
// «вывода важных событий», а не поиска отдельных статей.

const BASE = 'https://eventregistry.org/api/v1';

export function getNewsApiAiKey(): string {
  const k = process.env.NEWSAPI_AI_KEY;
  if (!k) throw new Error('NEWSAPI_AI_KEY is not set');
  return k;
}

export type NewsApiAiEndpoint =
  | '/event/getEvents'
  | '/event/getEvent'
  | '/article/getArticles'
  | '/suggestConceptsFast'
  | '/suggestCategoriesFast'
  | '/suggestSourcesFast';

export type NewsApiAiRequest = {
  endpoint: NewsApiAiEndpoint;
  params: Record<string, string>;   // apiKey подставится сам
};

export function buildNewsApiAiUrl(req: NewsApiAiRequest, maskKey = false): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(req.params)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  sp.set('apiKey', maskKey ? '***MASKED***' : getNewsApiAiKey());
  return `${BASE}${req.endpoint}?${sp.toString()}`;
}

export async function callNewsApiAi(req: NewsApiAiRequest): Promise<{
  url: string;
  status: number;
  contentType: string;
  body: any;
}> {
  const url = buildNewsApiAiUrl(req, false);
  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let body: any = text;
  if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return {
    url: buildNewsApiAiUrl(req, true),
    status: res.status,
    contentType: ct,
    body,
  };
}
