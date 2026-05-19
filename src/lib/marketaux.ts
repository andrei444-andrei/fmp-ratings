// Клиент Marketaux News API.
// Документация: https://www.marketaux.com/documentation
// Auth: API token через ?api_token=... в query или Authorization: Bearer.

const BASE = 'https://api.marketaux.com/v1/news/all';
const BASE_V1 = 'https://api.marketaux.com/v1';

export function getMarketauxToken(): string {
  const k = process.env.MARKETAUX_KEY;
  if (!k) throw new Error('MARKETAUX_KEY is not set');
  return k;
}

// ===== Универсальный конструктор запросов для /admin/marketaux =====

export type MarketauxEndpoint =
  | '/news/all'
  | '/news/by-uuid'
  | '/news/similar'
  | '/news/sources'
  | '/entity/search'
  | '/entity/stats'
  | '/entity/stats/intraday'
  | '/entity/stats/aggregation'
  | '/entity/type/list'
  | '/entity/industry/list';

export type MarketauxRequest = {
  endpoint: MarketauxEndpoint;
  uuid?: string;
  params: Record<string, string>;
};

export function buildMarketauxUrl(req: MarketauxRequest, maskToken = false): string {
  let path: string = req.endpoint;
  if ((req.endpoint === '/news/by-uuid' || req.endpoint === '/news/similar') && req.uuid) {
    path = `${req.endpoint}/${encodeURIComponent(req.uuid)}`;
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(req.params)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const token = maskToken ? '***MASKED***' : getMarketauxToken();
  sp.set('api_token', token);
  return `${BASE_V1}${path}?${sp.toString()}`;
}

export async function callMarketaux(req: MarketauxRequest): Promise<{
  url: string;
  status: number;
  contentType: string;
  body: any;
  rateLimit?: Record<string, string>;
}> {
  const url = buildMarketauxUrl(req, false);
  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let body: any = text;
  if (ct.includes('json')) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  const rateLimit: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    if (k.toLowerCase().includes('ratelimit') || k.toLowerCase() === 'x-request-id') {
      rateLimit[k] = v;
    }
  }
  return {
    url: buildMarketauxUrl(req, true),
    status: res.status,
    contentType: ct,
    body,
    rateLimit: Object.keys(rateLimit).length ? rateLimit : undefined,
  };
}

export type MarketauxArticle = {
  uuid?: string;
  url: string;
  title: string;
  description?: string;
  snippet?: string;
  source: string;          // domain
  publishedAt: string;     // YYYY-MM-DD (нормализовано)
  publishedAtFull: string; // ISO с таймштампом — для сортировки
  language?: string;
  sentiment?: number;      // -1..1
  entities?: Array<{
    symbol?: string;
    name?: string;
    exchange?: string;
    country?: string;
    type?: string;
    industry?: string;
    sentiment_score?: number;
  }>;
};

function isoFromDateRange(date: string, kind: 'start' | 'end'): string {
  // published_after — exclusive; published_before — inclusive по их доке.
  return kind === 'start' ? `${date}T00:00:00` : `${date}T23:59:59`;
}

export async function marketauxSearch(opts: {
  apiToken: string;
  date?: string;          // YYYY-MM-DD — поиск за конкретный день
  dateFrom?: string;      // если задан date — игнорируется
  dateTo?: string;
  search?: string;        // полнотекстовый запрос
  symbols?: string;       // 'AAPL,MSFT'
  countries?: string;     // 'us,gb,de,jp'
  industries?: string;
  language?: string;      // 'en'
  limit?: number;         // на Standard plan — до 100
  sort?: 'published_at' | 'relevance_score';
  sortOrder?: 'asc' | 'desc';
  filterEntities?: boolean;
  mustHaveEntities?: boolean;
  timeoutMs?: number;
}): Promise<MarketauxArticle[]> {
  const params = new URLSearchParams();
  params.set('api_token', opts.apiToken);
  params.set('language', opts.language || 'en');
  params.set('limit', String(Math.max(1, Math.min(100, opts.limit ?? 50))));
  params.set('sort', opts.sort || 'published_at');
  params.set('sort_order', opts.sortOrder || 'desc');
  if (opts.search) params.set('search', opts.search);
  if (opts.symbols) params.set('symbols', opts.symbols);
  if (opts.countries) params.set('countries', opts.countries);
  if (opts.industries) params.set('industries', opts.industries);
  if (opts.filterEntities) params.set('filter_entities', 'true');
  if (opts.mustHaveEntities) params.set('must_have_entities', 'true');
  if (opts.date) {
    params.set('published_after', isoFromDateRange(opts.date, 'start'));
    params.set('published_before', isoFromDateRange(opts.date, 'end'));
  } else {
    if (opts.dateFrom) params.set('published_after', isoFromDateRange(opts.dateFrom, 'start'));
    if (opts.dateTo)   params.set('published_before', isoFromDateRange(opts.dateTo, 'end'));
  }

  const url = `${BASE}?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`Marketaux timeout ${opts.timeoutMs ?? 20000}ms`);
    throw new Error(`Marketaux fetch: ${e.message}`);
  }
  clearTimeout(timer);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Marketaux ${res.status}: ${body.slice(0, 300)}`);
  }
  let data: any;
  try { data = JSON.parse(body); } catch {
    throw new Error(`Marketaux non-JSON: ${body.slice(0, 200)}`);
  }
  if (data?.error) {
    throw new Error(`Marketaux error: ${data.error.code || ''} ${data.error.message || JSON.stringify(data.error)}`.trim());
  }
  const arr: any[] = Array.isArray(data?.data) ? data.data : [];
  return arr.map(a => ({
    uuid: a.uuid,
    url: String(a.url || ''),
    title: String(a.title || ''),
    description: typeof a.description === 'string' ? a.description : undefined,
    snippet: typeof a.snippet === 'string' ? a.snippet : undefined,
    source: String(a.source || ''),
    publishedAt: typeof a.published_at === 'string' ? a.published_at.slice(0, 10) : '',
    publishedAtFull: typeof a.published_at === 'string' ? a.published_at : '',
    language: a.language,
    sentiment: typeof a?.entities?.[0]?.sentiment_score === 'number' ? a.entities[0].sentiment_score : undefined,
    entities: Array.isArray(a.entities) ? a.entities : undefined,
  })).filter(a => a.url && a.title && a.publishedAt);
}
