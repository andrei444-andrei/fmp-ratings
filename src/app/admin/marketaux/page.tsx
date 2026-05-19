'use client';

import { useMemo, useState } from 'react';

type Endpoint =
  | '/news/all' | '/news/by-uuid' | '/news/similar' | '/news/sources'
  | '/entity/search' | '/entity/stats' | '/entity/stats/intraday'
  | '/entity/stats/aggregation' | '/entity/type/list' | '/entity/industry/list';

const ENDPOINTS: { v: Endpoint; label: string; needsUuid?: boolean; hint?: string }[] = [
  { v: '/news/all', label: 'GET /news/all', hint: 'Главный поиск новостей с фильтрами' },
  { v: '/news/by-uuid', label: 'GET /news/by-uuid/{uuid}', needsUuid: true, hint: 'Одна статья по UUID' },
  { v: '/news/similar', label: 'GET /news/similar/{uuid}', needsUuid: true, hint: 'Похожие статьи' },
  { v: '/news/sources', label: 'GET /news/sources', hint: 'Список источников' },
  { v: '/entity/search', label: 'GET /entity/search', hint: 'Поиск тикеров/индексов/фондов' },
  { v: '/entity/stats', label: 'GET /entity/stats', hint: 'Статистика упоминаний' },
  { v: '/entity/stats/intraday', label: 'GET /entity/stats/intraday' },
  { v: '/entity/stats/aggregation', label: 'GET /entity/stats/aggregation' },
  { v: '/entity/type/list', label: 'GET /entity/type/list', hint: 'Список типов сущностей' },
  { v: '/entity/industry/list', label: 'GET /entity/industry/list', hint: 'Список индустрий' },
];

// Поля параметров по endpoint'ам. Все опциональные.
// kind: 'text'|'num'|'bool'|'date'|'select'
type Field = {
  key: string;
  label: string;
  kind: 'text' | 'num' | 'bool' | 'date' | 'select';
  options?: string[];
  placeholder?: string;
  hint?: string;
};

const NEWS_ALL_FIELDS: Field[] = [
  { key: 'symbols', label: 'symbols', kind: 'text', placeholder: 'AAPL,TSLA,SPY', hint: 'через запятую' },
  { key: 'entity_types', label: 'entity_types', kind: 'text', placeholder: 'equity,index,etf,mutualfund,currency,cryptocurrency' },
  { key: 'industries', label: 'industries', kind: 'text', placeholder: 'Technology,Healthcare' },
  { key: 'countries', label: 'countries', kind: 'text', placeholder: 'us,gb,de' },
  { key: 'sentiment_gte', label: 'sentiment_gte', kind: 'num', placeholder: '-1..1' },
  { key: 'sentiment_lte', label: 'sentiment_lte', kind: 'num', placeholder: '-1..1' },
  { key: 'min_match_score', label: 'min_match_score', kind: 'num', placeholder: '0..100' },
  { key: 'filter_entities', label: 'filter_entities', kind: 'bool' },
  { key: 'must_have_entities', label: 'must_have_entities', kind: 'bool' },
  { key: 'group_similar', label: 'group_similar', kind: 'bool' },
  { key: 'search', label: 'search', kind: 'text', placeholder: '+oil -gas "rate hike"' },
  { key: 'domains', label: 'domains', kind: 'text', placeholder: 'bloomberg.com,reuters.com' },
  { key: 'exclude_domains', label: 'exclude_domains', kind: 'text' },
  { key: 'source_ids', label: 'source_ids', kind: 'text' },
  { key: 'exclude_source_ids', label: 'exclude_source_ids', kind: 'text' },
  { key: 'language', label: 'language', kind: 'text', placeholder: 'en' },
  { key: 'published_before', label: 'published_before', kind: 'date' },
  { key: 'published_after', label: 'published_after', kind: 'date' },
  { key: 'published_on', label: 'published_on', kind: 'date' },
  { key: 'sort', label: 'sort', kind: 'select', options: ['published_at', 'published_desc', 'entity_match_score', 'entity_sentiment_score', 'relevance_score'] },
  { key: 'sort_order', label: 'sort_order', kind: 'select', options: ['asc', 'desc'] },
  { key: 'limit', label: 'limit', kind: 'num', placeholder: '3-100 (free=3)' },
  { key: 'page', label: 'page', kind: 'num', placeholder: '1' },
];

const NEWS_SOURCES_FIELDS: Field[] = [
  { key: 'language', label: 'language', kind: 'text', placeholder: 'en' },
  { key: 'countries', label: 'countries', kind: 'text' },
  { key: 'source_categories', label: 'source_categories', kind: 'text', placeholder: 'general,business,finance' },
  { key: 'page', label: 'page', kind: 'num' },
];

const ENTITY_SEARCH_FIELDS: Field[] = [
  { key: 'search', label: 'search', kind: 'text', placeholder: 'apple' },
  { key: 'symbols', label: 'symbols', kind: 'text' },
  { key: 'exchanges', label: 'exchanges', kind: 'text', placeholder: 'NASDAQ,NYSE' },
  { key: 'countries', label: 'countries', kind: 'text' },
  { key: 'industries', label: 'industries', kind: 'text' },
  { key: 'types', label: 'types', kind: 'text', placeholder: 'equity,index,etf' },
  { key: 'page', label: 'page', kind: 'num' },
];

const ENTITY_STATS_FIELDS: Field[] = [
  { key: 'symbols', label: 'symbols', kind: 'text' },
  { key: 'industries', label: 'industries', kind: 'text' },
  { key: 'countries', label: 'countries', kind: 'text' },
  { key: 'date_from', label: 'date_from', kind: 'date' },
  { key: 'date_to', label: 'date_to', kind: 'date' },
  { key: 'published_after', label: 'published_after', kind: 'date' },
  { key: 'published_before', label: 'published_before', kind: 'date' },
];

const ENTITY_INTRADAY_FIELDS: Field[] = [
  { key: 'symbols', label: 'symbols', kind: 'text' },
  { key: 'published_after', label: 'published_after', kind: 'date' },
  { key: 'published_before', label: 'published_before', kind: 'date' },
  { key: 'interval_minutes', label: 'interval_minutes', kind: 'num', placeholder: '5,15,30,60' },
];

const ENTITY_AGGREGATION_FIELDS: Field[] = [
  { key: 'symbols', label: 'symbols', kind: 'text' },
  { key: 'industries', label: 'industries', kind: 'text' },
  { key: 'date_from', label: 'date_from', kind: 'date' },
  { key: 'date_to', label: 'date_to', kind: 'date' },
  { key: 'group_by', label: 'group_by', kind: 'select', options: ['day', 'week', 'month'] },
];

function fieldsFor(ep: Endpoint): Field[] {
  switch (ep) {
    case '/news/all':
    case '/news/by-uuid':
    case '/news/similar':
      return NEWS_ALL_FIELDS;
    case '/news/sources':
      return NEWS_SOURCES_FIELDS;
    case '/entity/search':
      return ENTITY_SEARCH_FIELDS;
    case '/entity/stats':
      return ENTITY_STATS_FIELDS;
    case '/entity/stats/intraday':
      return ENTITY_INTRADAY_FIELDS;
    case '/entity/stats/aggregation':
      return ENTITY_AGGREGATION_FIELDS;
    case '/entity/type/list':
    case '/entity/industry/list':
    default:
      return [];
  }
}

function parseExtras(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export default function MarketauxDebugPage() {
  const [endpoint, setEndpoint] = useState<Endpoint>('/news/all');
  const [uuid, setUuid] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [extrasRaw, setExtrasRaw] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    url: string; status: number; contentType: string; body: any;
    rateLimit?: Record<string, string>;
  } | null>(null);

  const fields = useMemo(() => fieldsFor(endpoint), [endpoint]);
  const needsUuid = endpoint === '/news/by-uuid' || endpoint === '/news/similar';

  const params = useMemo<Record<string, string>>(() => {
    const merged: Record<string, string> = {};
    for (const f of fields) {
      const v = fieldValues[f.key];
      if (v == null) continue;
      const s = String(v).trim();
      if (!s) continue;
      merged[f.key] = s;
    }
    Object.assign(merged, parseExtras(extrasRaw));
    return merged;
  }, [fields, fieldValues, extrasRaw]);

  const previewUrl = useMemo(() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) sp.set(k, v);
    sp.set('api_token', '***MASKED***');
    let path: string = endpoint;
    if (needsUuid && uuid) {
      path = `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(uuid)}`;
    }
    return `https://api.marketaux.com/v1${path}?${sp.toString()}`;
  }, [endpoint, needsUuid, uuid, params]);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/marketaux/debug', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, uuid: needsUuid ? uuid : undefined, params }),
      }).then(r => r.json());
      if (res?.error) { setError(res.error); return; }
      setResult(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function copyUrl() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(previewUrl).catch(() => {});
    }
  }
  function downloadJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.body, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `marketaux-${endpoint.replace(/\//g, '_')}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }
  function clearForm() {
    setFieldValues({});
    setUuid('');
    setExtrasRaw('');
    setResult(null);
    setError(null);
  }

  const epMeta = ENDPOINTS.find(e => e.v === endpoint);
  const articles: any[] | null = useMemo(() => {
    if (!result || !result.body) return null;
    const b = result.body;
    if (Array.isArray(b?.data)) return b.data;
    return null;
  }, [result]);

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">Marketaux — отладка API</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Конструктор запросов к <a href="https://www.marketaux.com/documentation" target="_blank" rel="noreferrer"
            className="underline">Marketaux News API</a>.
          Серверный proxy <code>/api/marketaux/debug</code> подставляет <code>MARKETAUX_API_TOKEN</code> из env
          и возвращает ответ как есть. Токен в превью URL замаскирован.
        </p>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Endpoint</span>
            <select className="input" value={endpoint}
              onChange={e => { setEndpoint(e.target.value as Endpoint); setResult(null); }}>
              {ENDPOINTS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
            </select>
          </label>
          {needsUuid && (
            <label className="flex flex-col">
              <span className="label">UUID</span>
              <input className="input w-[340px]" value={uuid} onChange={e => setUuid(e.target.value)}
                placeholder="например: a1b2c3d4-..." />
            </label>
          )}
          <button className="btn-primary" onClick={run} disabled={loading || (needsUuid && !uuid)}>
            {loading ? '…запрос' : '▶ Отправить'}
          </button>
          <button className="btn" onClick={clearForm}>Очистить</button>
        </div>
        {epMeta?.hint && <p className="text-xs text-neutral-500 mt-1">{epMeta.hint}</p>}
      </section>

      {fields.length > 0 && (
        <section className="card">
          <h3 className="font-semibold mb-2">Параметры</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fields.map(f => (
              <label key={f.key} className="flex flex-col">
                <span className="label">
                  {f.label}
                  {f.hint && <span className="text-neutral-400 ml-1">({f.hint})</span>}
                </span>
                {f.kind === 'bool' ? (
                  <select
                    className="input"
                    value={fieldValues[f.key] ?? ''}
                    onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))}
                  >
                    <option value="">—</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : f.kind === 'select' ? (
                  <select
                    className="input"
                    value={fieldValues[f.key] ?? ''}
                    onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))}
                  >
                    <option value="">—</option>
                    {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.kind === 'date' ? 'date' : f.kind === 'num' ? 'number' : 'text'}
                    className="input"
                    value={fieldValues[f.key] ?? ''}
                    onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                )}
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h3 className="font-semibold mb-2">Произвольные параметры</h3>
        <p className="text-xs text-neutral-500 mb-2">
          Формат <code>key=value</code> по одной строке. Эти параметры добавятся / переопределят значения из формы выше.
        </p>
        <textarea
          className="input w-full font-mono text-xs"
          rows={4}
          value={extrasRaw}
          onChange={e => setExtrasRaw(e.target.value)}
          placeholder={'# пример:\nsearch=oil\nlimit=10'}
        />
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Превью URL</h3>
        <div className="flex gap-2 mb-2">
          <button className="btn" onClick={copyUrl}>Скопировать URL</button>
          <span className="text-xs text-neutral-500 self-center">api_token замаскирован</span>
        </div>
        <pre className="bg-neutral-900 text-neutral-100 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
{previewUrl}
        </pre>
      </section>

      {error && (
        <section className="card border-red-300 bg-red-50">
          <h3 className="font-semibold text-red-700">Ошибка</h3>
          <pre className="text-xs text-red-700 whitespace-pre-wrap">{error}</pre>
        </section>
      )}

      {result && (
        <>
          <section className="card">
            <h3 className="font-semibold mb-2">Ответ</h3>
            <div className="flex flex-wrap gap-4 text-sm mb-2">
              <span><b>HTTP</b>: <code>{result.status}</code></span>
              <span><b>content-type</b>: <code>{result.contentType || '—'}</code></span>
              {result.body?.meta?.found != null && (
                <span><b>found</b>: <code>{result.body.meta.found}</code></span>
              )}
              {result.body?.meta?.returned != null && (
                <span><b>returned</b>: <code>{result.body.meta.returned}</code></span>
              )}
              {result.body?.meta?.limit != null && (
                <span><b>limit</b>: <code>{result.body.meta.limit}</code></span>
              )}
              {result.body?.meta?.page != null && (
                <span><b>page</b>: <code>{result.body.meta.page}</code></span>
              )}
              <button className="btn ml-auto" onClick={downloadJson}>Скачать JSON</button>
            </div>
            {result.rateLimit && (
              <div className="text-xs text-neutral-500 mb-2">
                {Object.entries(result.rateLimit).map(([k, v]) => (
                  <span key={k} className="mr-3">{k}: <code>{v}</code></span>
                ))}
              </div>
            )}
            {result.body?.error && (
              <div className="bg-red-100 text-red-800 rounded p-2 text-sm mb-2">
                <b>API error:</b> {typeof result.body.error === 'string'
                  ? result.body.error
                  : (result.body.error?.message || JSON.stringify(result.body.error))}
              </div>
            )}
          </section>

          {articles && articles.length > 0 && (
            <section className="card">
              <h3 className="font-semibold mb-2">Статьи ({articles.length})</h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {articles.map((a: any, i: number) => (
                  <div key={a.uuid || i} className="border border-neutral-200 rounded p-2">
                    <div className="flex justify-between items-start gap-2 flex-wrap">
                      <a href={a.url} target="_blank" rel="noreferrer"
                        className="font-medium text-sm hover:underline">
                        {a.title}
                      </a>
                      <span className="text-xs text-neutral-500 font-mono whitespace-nowrap">
                        {a.published_at?.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                    {a.snippet && (
                      <p className="text-xs text-neutral-600 mt-1">{a.snippet}</p>
                    )}
                    <div className="text-xs text-neutral-500 mt-1 flex gap-3 flex-wrap">
                      {a.source && <span>📰 {a.source}</span>}
                      {a.language && <span>lang: {a.language}</span>}
                      {a.uuid && <code className="text-[10px]">{a.uuid}</code>}
                      {Array.isArray(a.entities) && a.entities.length > 0 && (
                        <span>сущности: {a.entities.map((e: any) => e.symbol || e.name).filter(Boolean).join(', ')}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <h3 className="font-semibold mb-2">Сырой JSON</h3>
            <pre className="bg-neutral-900 text-neutral-100 rounded p-2 text-xs overflow-auto max-h-[600px]">
{JSON.stringify(result.body, null, 2)}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
