// Клиент Marketaux News API.
// Документация: https://www.marketaux.com/documentation
// Auth: API token через ?api_token=... в query или Authorization: Bearer.

const BASE = 'https://api.marketaux.com/v1/news/all';

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
