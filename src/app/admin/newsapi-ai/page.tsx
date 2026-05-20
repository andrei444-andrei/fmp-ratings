'use client';

import { useMemo, useState } from 'react';

type Endpoint =
  | '/event/getEvents' | '/event/getEvent' | '/article/getArticles'
  | '/suggestConceptsFast' | '/suggestCategoriesFast' | '/suggestSourcesFast';

const ENDPOINTS: { v: Endpoint; label: string; hint?: string }[] = [
  { v: '/event/getEvents', label: 'event/getEvents — СОБЫТИЯ (рекомендуется)', hint: 'Кластеры статей с totalArticleCount = значимость' },
  { v: '/event/getEvent', label: 'event/getEvent — одно событие по uri' },
  { v: '/article/getArticles', label: 'article/getArticles — поиск статей' },
  { v: '/suggestConceptsFast', label: 'suggestConceptsFast — найти conceptUri' },
  { v: '/suggestCategoriesFast', label: 'suggestCategoriesFast — найти categoryUri' },
  { v: '/suggestSourcesFast', label: 'suggestSourcesFast — найти sourceUri' },
];

type Field = {
  key: string;
  label: string;
  kind: 'text' | 'num' | 'bool' | 'date' | 'select';
  options?: string[];
  placeholder?: string;
  hint?: string;
  default?: string;
};

const GET_EVENTS_FIELDS: Field[] = [
  { key: 'keyword', label: 'keyword', kind: 'text', placeholder: 'Federal Reserve rate' },
  { key: 'conceptUri', label: 'conceptUri', kind: 'text', placeholder: 'http://en.wikipedia.org/wiki/Federal_Reserve', hint: 'через suggestConceptsFast' },
  { key: 'categoryUri', label: 'categoryUri', kind: 'text', placeholder: 'dmoz/Business', hint: 'через suggestCategoriesFast' },
  { key: 'lang', label: 'lang', kind: 'text', placeholder: 'eng', default: 'eng' },
  { key: 'dateStart', label: 'dateStart', kind: 'date' },
  { key: 'dateEnd', label: 'dateEnd', kind: 'date' },
  { key: 'eventsSortBy', label: 'eventsSortBy', kind: 'select', options: ['size', 'date', 'rel', 'socialScore'], default: 'size', hint: 'size = число статей' },
  { key: 'minArticlesInEvent', label: 'minArticlesInEvent', kind: 'num', placeholder: '50', hint: 'отсечь мелочь' },
  { key: 'eventsCount', label: 'eventsCount', kind: 'num', placeholder: '20 (≤50)', default: '20' },
  { key: 'eventsPage', label: 'eventsPage', kind: 'num', placeholder: '1' },
  { key: 'locationUri', label: 'locationUri', kind: 'text', placeholder: 'http://en.wikipedia.org/wiki/United_States' },
  { key: 'includeEventSummary', label: 'includeEventSummary', kind: 'bool', default: 'true' },
  { key: 'includeEventConcepts', label: 'includeEventConcepts', kind: 'bool', default: 'true' },
  { key: 'includeEventCategories', label: 'includeEventCategories', kind: 'bool', default: 'true' },
];

const GET_EVENT_FIELDS: Field[] = [
  { key: 'eventUri', label: 'eventUri', kind: 'text', placeholder: 'eng-1234567' },
  { key: 'lang', label: 'lang', kind: 'text', default: 'eng' },
  { key: 'includeEventSummary', label: 'includeEventSummary', kind: 'bool', default: 'true' },
  { key: 'includeEventArticles', label: 'includeEventArticles', kind: 'bool' },
];

const GET_ARTICLES_FIELDS: Field[] = [
  { key: 'keyword', label: 'keyword', kind: 'text' },
  { key: 'conceptUri', label: 'conceptUri', kind: 'text' },
  { key: 'categoryUri', label: 'categoryUri', kind: 'text' },
  { key: 'sourceUri', label: 'sourceUri', kind: 'text', placeholder: 'reuters.com' },
  { key: 'lang', label: 'lang', kind: 'text', default: 'eng' },
  { key: 'dateStart', label: 'dateStart', kind: 'date' },
  { key: 'dateEnd', label: 'dateEnd', kind: 'date' },
  { key: 'articlesSortBy', label: 'articlesSortBy', kind: 'select', options: ['date', 'rel', 'sourceImportance', 'socialScore'], default: 'rel' },
  { key: 'articlesCount', label: 'articlesCount', kind: 'num', placeholder: '20 (≤100)', default: '20' },
  { key: 'articlesPage', label: 'articlesPage', kind: 'num' },
];

const SUGGEST_FIELDS: Field[] = [
  { key: 'prefix', label: 'prefix', kind: 'text', placeholder: 'Federal Reserve' },
  { key: 'lang', label: 'lang', kind: 'text', default: 'eng' },
];

function fieldsFor(ep: Endpoint): Field[] {
  switch (ep) {
    case '/event/getEvents': return GET_EVENTS_FIELDS;
    case '/event/getEvent': return GET_EVENT_FIELDS;
    case '/article/getArticles': return GET_ARTICLES_FIELDS;
    default: return SUGGEST_FIELDS;
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

function defaultsFor(fields: Field[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) if (f.default != null) out[f.key] = f.default;
  return out;
}

export default function NewsApiAiDebugPage() {
  const [endpoint, setEndpoint] = useState<Endpoint>('/event/getEvents');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(defaultsFor(GET_EVENTS_FIELDS));
  const [extrasRaw, setExtrasRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; status: number; contentType: string; body: any } | null>(null);

  const fields = useMemo(() => fieldsFor(endpoint), [endpoint]);

  function switchEndpoint(ep: Endpoint) {
    setEndpoint(ep);
    setFieldValues(defaultsFor(fieldsFor(ep)));
    setResult(null);
  }

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
    sp.set('apiKey', '***MASKED***');
    return `https://eventregistry.org/api/v1${endpoint}?${sp.toString()}`;
  }, [endpoint, params]);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/newsapi-ai/debug', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, params }),
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
    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(previewUrl).catch(() => {});
  }
  function downloadJson() {
    if (!result) return;
    const data = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `newsapi-ai-${endpoint.replace(/\//g, '_')}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  // Извлекаем события из ответа getEvents
  const events: any[] | null = useMemo(() => {
    if (!result?.body) return null;
    const r = result.body?.events?.results;
    return Array.isArray(r) ? r : null;
  }, [result]);

  const articles: any[] | null = useMemo(() => {
    if (!result?.body) return null;
    const r = result.body?.articles?.results;
    return Array.isArray(r) ? r : null;
  }, [result]);

  const epMeta = ENDPOINTS.find(e => e.v === endpoint);

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">NewsAPI.ai / Event Registry — отладка</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Конструктор запросов к <a href="https://www.newsapi.ai/documentation" target="_blank" rel="noreferrer"
            className="underline">Event Registry API</a>. Серверный proxy <code>/api/newsapi-ai/debug</code> подставляет
          <code> NEWSAPI_AI_KEY</code>. <b>event/getEvents</b> — автокластеризованные события, сортировка <code>size</code> +
          <code>minArticlesInEvent</code> выводит только крупные.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Endpoint</span>
            <select className="input w-[360px]" value={endpoint} onChange={e => switchEndpoint(e.target.value as Endpoint)}>
              {ENDPOINTS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
            </select>
          </label>
          <button className="btn-primary" onClick={run} disabled={loading}>
            {loading ? '…запрос' : '▶ Отправить'}
          </button>
        </div>
        {epMeta?.hint && <p className="text-xs text-neutral-500 mt-1">{epMeta.hint}</p>}
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Параметры</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {fields.map(f => (
            <label key={f.key} className="flex flex-col">
              <span className="label">
                {f.label}{f.hint && <span className="text-neutral-400 ml-1">({f.hint})</span>}
              </span>
              {f.kind === 'bool' ? (
                <select className="input" value={fieldValues[f.key] ?? ''}
                  onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))}>
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : f.kind === 'select' ? (
                <select className="input" value={fieldValues[f.key] ?? ''}
                  onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))}>
                  <option value="">—</option>
                  {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.kind === 'date' ? 'date' : f.kind === 'num' ? 'number' : 'text'}
                  className="input" value={fieldValues[f.key] ?? ''} placeholder={f.placeholder}
                  onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))} />
              )}
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Произвольные параметры</h3>
        <p className="text-xs text-neutral-500 mb-2"><code>key=value</code> по строке; добавятся / переопределят форму.</p>
        <textarea className="input w-full font-mono text-xs" rows={3}
          value={extrasRaw} onChange={e => setExtrasRaw(e.target.value)}
          placeholder={'# пример:\nignoreKeyword=sports'} />
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Превью URL</h3>
        <div className="flex gap-2 mb-2">
          <button className="btn" onClick={copyUrl}>Скопировать URL</button>
          <span className="text-xs text-neutral-500 self-center">apiKey замаскирован</span>
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
              {events && <span><b>events</b>: <code>{events.length}</code> / всего <code>{result.body?.events?.totalResults ?? '—'}</code></span>}
              {articles && <span><b>articles</b>: <code>{articles.length}</code></span>}
              <button className="btn ml-auto" onClick={downloadJson}>Скачать JSON</button>
            </div>
          </section>

          {events && events.length > 0 && (
            <section className="card">
              <h3 className="font-semibold mb-2">События ({events.length}) — по убыванию значимости</h3>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {events.map((ev: any, i: number) => {
                  const title = ev.title?.eng || ev.title?.[Object.keys(ev.title || {})[0]] || '(без заголовка)';
                  const summary = ev.summary?.eng || '';
                  const concepts = Array.isArray(ev.concepts)
                    ? ev.concepts.slice(0, 6).map((c: any) => c.label?.eng || c.label?.[Object.keys(c.label || {})[0]]).filter(Boolean)
                    : [];
                  return (
                    <div key={ev.uri || i} className="border border-neutral-200 rounded p-2">
                      <div className="flex justify-between items-start gap-2 flex-wrap">
                        <span className="font-medium text-sm">{title}</span>
                        <span className="text-xs whitespace-nowrap">
                          <span className="bg-blue-100 text-blue-800 rounded px-1.5 py-0.5 font-mono">
                            {ev.totalArticleCount ?? '?'} статей
                          </span>
                          <span className="text-neutral-500 ml-2 font-mono">{ev.eventDate || ''}</span>
                        </span>
                      </div>
                      {summary && <p className="text-xs text-neutral-600 mt-1 line-clamp-3">{summary.slice(0, 300)}</p>}
                      {concepts.length > 0 && (
                        <div className="text-xs text-neutral-500 mt-1">
                          {concepts.map((c: string, j: number) => (
                            <span key={j} className="inline-block bg-neutral-100 rounded px-1.5 py-0.5 mr-1 mb-1">{c}</span>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-neutral-400 mt-1 font-mono">{ev.uri}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {articles && articles.length > 0 && (
            <section className="card">
              <h3 className="font-semibold mb-2">Статьи ({articles.length})</h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {articles.map((a: any, i: number) => (
                  <div key={a.uri || i} className="border border-neutral-200 rounded p-2">
                    <div className="flex justify-between items-start gap-2 flex-wrap">
                      <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-sm hover:underline">{a.title}</a>
                      <span className="text-xs text-neutral-500 font-mono whitespace-nowrap">{a.date || ''}</span>
                    </div>
                    <div className="text-xs text-neutral-500 mt-1 flex gap-3 flex-wrap">
                      {a.source?.title && <span>📰 {a.source.title}</span>}
                      {a.lang && <span>lang: {a.lang}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <h3 className="font-semibold mb-2">Сырой JSON</h3>
            <pre className="bg-neutral-900 text-neutral-100 rounded p-2 text-xs overflow-auto max-h-[600px]">
{typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
