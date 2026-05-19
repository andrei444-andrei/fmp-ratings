// Клиент GDELT 2.0 DOC API (artlist).
// Бесплатный, без ключа. Покрытие — с 2015 г. (для v2).
// Документация: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

export type GdeltArticle = {
  url: string;
  title: string;
  seendate: string;     // YYYY-MM-DD
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

function ymdToCompact(iso: string, time = '000000'): string {
  return iso.replace(/-/g, '') + time;
}

function parseSeenDate(s: string): string {
  // GDELT format: 20240315T123000Z → 2024-03-15
  if (typeof s !== 'string' || s.length < 8) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export async function gdeltSearch(opts: {
  query: string;
  startDate: string;    // YYYY-MM-DD
  endDate: string;      // YYYY-MM-DD
  maxRecords?: number;  // ≤ 250
  sort?: 'datedesc' | 'dateasc' | 'hybridrel' | 'tonedesc' | 'toneasc';
}): Promise<GdeltArticle[]> {
  const params = new URLSearchParams({
    query: opts.query,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(Math.min(opts.maxRecords ?? 250, 250)),
    sort: opts.sort || 'hybridrel',
    startdatetime: ymdToCompact(opts.startDate, '000000'),
    enddatetime: ymdToCompact(opts.endDate, '235959'),
  });
  const url = `${BASE}?${params.toString()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': 'fmp-ratings/1.0 (+market-events)' },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GDELT ${res.status}: ${t.slice(0, 300)}`);
  }
  // GDELT иногда возвращает HTML с предупреждением о rate-limit
  const ct = res.headers.get('content-type') || '';
  const body = await res.text();
  if (!ct.includes('json')) {
    throw new Error(`GDELT non-JSON: ${body.slice(0, 200)}`);
  }
  let data: any;
  try { data = JSON.parse(body); } catch {
    throw new Error(`GDELT invalid JSON: ${body.slice(0, 200)}`);
  }
  const arr = Array.isArray(data?.articles) ? data.articles : [];
  return arr.map((a: any): GdeltArticle => ({
    url: String(a.url || ''),
    title: String(a.title || ''),
    seendate: parseSeenDate(a.seendate),
    domain: a.domain,
    language: a.language,
    sourcecountry: a.sourcecountry,
  })).filter((a: GdeltArticle) => a.url && a.title && a.seendate);
}
