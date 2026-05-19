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
  timeoutMs?: number;
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25000);
  let res: Response;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: {
        // GDELT блокирует некоторые программные UA — используем нейтральный.
        'user-agent': 'Mozilla/5.0 (compatible; market-events-research/1.0)',
        'accept': 'application/json,text/plain;q=0.9,*/*;q=0.5',
      },
    });
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error(`GDELT timeout ${opts.timeoutMs ?? 25000}ms`);
    throw new Error(`GDELT fetch: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`GDELT ${res.status}: ${body.slice(0, 300)}`);
  }
  const trimmed = body.trim();
  // Иногда GDELT отдаёт ошибку как HTML или plain text без content-type=json.
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    // Пустой ответ или сообщение об ошибке = просто 0 статей за этот год.
    if (/no\s+articles|no\s+results|too\s+many|rate/i.test(trimmed)) return [];
    if (!trimmed) return [];
    throw new Error(`GDELT non-JSON: ${trimmed.slice(0, 200)}`);
  }
  let data: any;
  try { data = JSON.parse(trimmed); } catch {
    throw new Error(`GDELT invalid JSON: ${trimmed.slice(0, 200)}`);
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
