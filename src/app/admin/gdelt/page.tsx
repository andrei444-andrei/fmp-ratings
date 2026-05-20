'use client';

import { useMemo, useState } from 'react';

const MODES = [
  'artlist', 'artgallery', 'imagecollage', 'imagecollageinfo',
  'timelinevol', 'timelinevolraw', 'timelinevolinfo', 'timelinetone',
  'timelinelang', 'timelinesourcecountry', 'tonechart',
  'wordcloudimagetags', 'wordcloudimagewebtags',
];
const FORMATS = ['json', 'csv', 'html', 'rss'];
const SORTS = ['hybridrel', 'datedesc', 'dateasc', 'tonedesc', 'toneasc'];
const TIMESPANS = ['', '15min', '1h', '12h', '1d', '3d', '1w', '1m', '3m', '6m', '1y', '2y'];

// Подсказки по операторам query
const OPERATOR_HINTS = [
  ['"phrase"', 'точная фраза'],
  ['(a OR b)', 'дизъюнкция'],
  ['-word', 'исключить'],
  ['sourcelang:eng', 'язык источника'],
  ['sourcecountry:US', 'страна источника'],
  ['domain:reuters.com', 'конкретный домен'],
  ['domainis:reuters.com', 'строго домен'],
  ['theme:ECON_STOCKMARKET', 'GKG-тема'],
  ['tone>5 / tone<-5', 'тональность'],
  ['near20:"fed rate"', 'слова рядом (≤20)'],
  ['repeat3:"war"', 'повтор ≥3 раз'],
];

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

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function yearsAgoIso(y: number): string {
  const d = new Date(); d.setFullYear(d.getFullYear() - y);
  return d.toISOString().slice(0, 10);
}

export default function GdeltDebugPage() {
  const [query, setQuery] = useState('("rate hike" OR "interest rate") sourcelang:eng');
  const [mode, setMode] = useState('artlist');
  const [format, setFormat] = useState('json');
  const [maxrecords, setMaxrecords] = useState('50');
  const [sort, setSort] = useState('hybridrel');
  const [useTimespan, setUseTimespan] = useState(false);
  const [timespan, setTimespan] = useState('1w');
  const [startDate, setStartDate] = useState(yearsAgoIso(1));
  const [endDate, setEndDate] = useState(todayIso());
  const [extrasRaw, setExtrasRaw] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    url: string; status: number; contentType: string; body: any;
  } | null>(null);

  const extra = useMemo(() => parseExtras(extrasRaw), [extrasRaw]);

  const previewUrl = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('query', query);
    sp.set('mode', mode);
    sp.set('format', format);
    if (maxrecords) sp.set('maxrecords', maxrecords);
    if (sort) sp.set('sort', sort);
    if (useTimespan && timespan) {
      sp.set('timespan', timespan);
    } else {
      if (startDate) sp.set('startdatetime', startDate.replace(/-/g, '') + '000000');
      if (endDate) sp.set('enddatetime', endDate.replace(/-/g, '') + '235959');
    }
    for (const [k, v] of Object.entries(extra)) sp.set(k, v);
    return `https://api.gdeltproject.org/api/v2/doc/doc?${sp.toString()}`;
  }, [query, mode, format, maxrecords, sort, useTimespan, timespan, startDate, endDate, extra]);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/gdelt/debug', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query, mode, format, maxrecords, sort,
          timespan: useTimespan ? timespan : '',
          startDate: useTimespan ? '' : startDate,
          endDate: useTimespan ? '' : endDate,
          extra,
        }),
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
    const data = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gdelt-${mode}-${Date.now()}.${format === 'json' ? 'json' : 'txt'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  const articles: any[] | null = useMemo(() => {
    if (!result?.body) return null;
    const b = result.body;
    if (Array.isArray(b?.articles)) return b.articles;
    return null;
  }, [result]);

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">GDELT 2.0 DOC — отладка</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Конструктор запросов к <a href="https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/"
            target="_blank" rel="noreferrer" className="underline">GDELT DOC 2.0 API</a> (бесплатный, без ключа,
          история с 2017). Серверный proxy <code>/api/gdelt/debug</code> учитывает rate-limit (1 запрос / 5 сек).
        </p>

        <label className="flex flex-col mb-3">
          <span className="label">query (поисковый запрос с операторами)</span>
          <textarea className="input w-full font-mono text-xs" rows={3}
            value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2 text-xs mb-3">
          {OPERATOR_HINTS.map(([op, desc]) => (
            <button key={op} type="button"
              className="border border-neutral-300 rounded px-1.5 py-0.5 hover:bg-neutral-100 font-mono"
              title={desc}
              onClick={() => setQuery(q => (q.trim() ? q.trim() + ' ' : '') + op)}>
              {op}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">mode</span>
            <select className="input" value={mode} onChange={e => setMode(e.target.value)}>
              {MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">format</span>
            <select className="input" value={format} onChange={e => setFormat(e.target.value)}>
              {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">maxrecords (≤250)</span>
            <input type="number" className="input w-24" value={maxrecords} min={1} max={250}
              onChange={e => setMaxrecords(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">sort</span>
            <select className="input" value={sort} onChange={e => setSort(e.target.value)}>
              {SORTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-3 items-end mt-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useTimespan} onChange={e => setUseTimespan(e.target.checked)} />
            <span className="text-sm">Использовать timespan вместо диапазона дат</span>
          </label>
          {useTimespan ? (
            <label className="flex flex-col">
              <span className="label">timespan</span>
              <select className="input" value={timespan} onChange={e => setTimespan(e.target.value)}>
                {TIMESPANS.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="flex flex-col">
                <span className="label">startdatetime</span>
                <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </label>
              <label className="flex flex-col">
                <span className="label">enddatetime</span>
                <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </label>
            </>
          )}
          <button className="btn-primary" onClick={run} disabled={loading || !query.trim()}>
            {loading ? '…запрос' : '▶ Отправить'}
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Произвольные параметры</h3>
        <p className="text-xs text-neutral-500 mb-2">
          <code>key=value</code> по одной строке (например <code>timelinesmooth=5</code>, <code>trans=googtrans</code>).
          Добавятся / переопределят значения выше.
        </p>
        <textarea className="input w-full font-mono text-xs" rows={3}
          value={extrasRaw} onChange={e => setExtrasRaw(e.target.value)}
          placeholder={'# пример:\ntimelinesmooth=7'} />
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Превью URL</h3>
        <div className="flex gap-2 mb-2">
          <button className="btn" onClick={copyUrl}>Скопировать URL</button>
          <a className="btn" href={previewUrl} target="_blank" rel="noreferrer">Открыть в браузере</a>
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
              {articles && <span><b>articles</b>: <code>{articles.length}</code></span>}
              <button className="btn ml-auto" onClick={downloadJson}>Скачать</button>
            </div>
          </section>

          {articles && articles.length > 0 && (
            <section className="card">
              <h3 className="font-semibold mb-2">Статьи ({articles.length})</h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {articles.map((a: any, i: number) => (
                  <div key={a.url || i} className="border border-neutral-200 rounded p-2">
                    <div className="flex justify-between items-start gap-2 flex-wrap">
                      <a href={a.url} target="_blank" rel="noreferrer"
                        className="font-medium text-sm hover:underline">{a.title}</a>
                      <span className="text-xs text-neutral-500 font-mono whitespace-nowrap">
                        {typeof a.seendate === 'string' ? a.seendate.slice(0, 8) : ''}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 mt-1 flex gap-3 flex-wrap">
                      {a.domain && <span>🌐 {a.domain}</span>}
                      {a.language && <span>lang: {a.language}</span>}
                      {a.sourcecountry && <span>country: {a.sourcecountry}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <h3 className="font-semibold mb-2">Сырой ответ</h3>
            <pre className="bg-neutral-900 text-neutral-100 rounded p-2 text-xs overflow-auto max-h-[600px]">
{typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
