'use client';

import { useEffect, useRef, useState } from 'react';

type EpsEvent = {
  symbol: string;
  date: string;
  fiscalDateEnding: string | null;
  epsActual: number | null;
  epsEstimated: number | null;
  surprise: number | null;
  surprisePct: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
  year: number;
  rank: number | null;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function EpsPage() {
  // === Раздел 1: сбор данных ===
  const [fromYear, setFromYear] = useState(2015);
  const [toYear, setToYear] = useState(2025);
  const [topNFetch, setTopNFetch] = useState(50);
  const [delayMs, setDelayMs] = useState(120);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const log = (m: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogLines(prev => [...prev, `[${ts}] ${m}`]);
  };
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  // === Раздел 2: просмотр / фильтры ===
  const [qFromYear, setQFromYear] = useState('');
  const [qToYear, setQToYear] = useState('');
  const [qTopN, setQTopN] = useState(50);
  const [qRestrict, setQRestrict] = useState(true);
  const [qDirection, setQDirection] = useState<'any' | 'beat' | 'miss'>('any');
  const [qMinPct, setQMinPct] = useState('');
  const [qMaxPct, setQMaxPct] = useState('');
  const [qSymbol, setQSymbol] = useState('');

  const [events, setEvents] = useState<EpsEvent[]>([]);
  const [stats, setStats] = useState<{ count: number; beat: number; miss: number; flat: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  function buildUrl() {
    const params = new URLSearchParams();
    if (qFromYear) params.set('fromYear', qFromYear);
    if (qToYear) params.set('toYear', qToYear);
    params.set('topN', String(qTopN));
    params.set('restrictToTop', qRestrict ? '1' : '0');
    params.set('direction', qDirection);
    if (qMinPct !== '') params.set('minSurprisePct', qMinPct);
    if (qMaxPct !== '') params.set('maxSurprisePct', qMaxPct);
    if (qSymbol) params.set('symbol', qSymbol);
    return `/api/eps/query?${params.toString()}`;
  }

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetch(buildUrl()).then(r => r.json());
      if (data.error) { setError(data.error); setEvents([]); setStats(null); }
      else { setEvents(data.events || []); setStats(data.stats || null); }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(loadEvents, 300) as unknown as number;
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qFromYear, qToYear, qTopN, qRestrict, qDirection, qMinPct, qMaxPct, qSymbol]);

  async function runFetch() {
    setLogLines([]);
    setRunning(true);
    setStatus('Старт...');
    try {
      log(`=== EPS Surprise: сбор для top-${topNFetch} за ${fromYear}–${toYear} ===`);
      const symRes = await fetch(`/api/eps/symbols?fromYear=${fromYear}&toYear=${toYear}&topN=${topNFetch}`).then(r => r.json());
      if (symRes.error) throw new Error(symRes.error);
      const symbols: string[] = symRes.symbols || [];
      log(`Уникальных символов в топ-${topNFetch}: ${symbols.length}`);
      if (!symbols.length) {
        log('Пусто. Сначала запустите Pipeline на главной — он формирует top_n_per_year.');
        setStatus('Нет символов в top_n_per_year');
        return;
      }
      let okCount = 0, emptyCount = 0, errCount = 0, totalRows = 0;
      for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i];
        setStatus(`${i + 1}/${symbols.length} ${s}`);
        try {
          const data = await fetch(`/api/fmp/earnings?symbol=${encodeURIComponent(s)}`).then(r => r.json());
          if (data?.error) throw new Error(data.error);
          if (!Array.isArray(data) || !data.length) { emptyCount++; }
          else {
            const save = await fetch('/api/eps/save', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(data),
            }).then(r => r.json());
            if (save.error) throw new Error(save.error);
            okCount++;
            totalRows += save.inserted || 0;
            if ((i + 1) % 10 === 0) log(`  ${i + 1}/${symbols.length}: ok=${okCount} empty=${emptyCount} err=${errCount} rows=${totalRows}`);
          }
        } catch (e: any) {
          errCount++;
          log(`  ${s}: ${e.message}`);
        }
        if (delayMs > 0) await sleep(delayMs);
      }
      log(`✓ Готово. ok=${okCount}, пусто=${emptyCount}, ошибок=${errCount}, всего строк=${totalRows}`);
      setStatus(`✓ ok=${okCount}, ошибок=${errCount}`);
      loadEvents();
    } catch (e: any) {
      log(`ABORT: ${e.message}`);
      setStatus(`Ошибка: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }

  function downloadCsv() {
    const headers = [
      'year', 'date', 'symbol', 'rank',
      'epsActual', 'epsEstimated', 'surprise', 'surprisePct',
      'revenueActual', 'revenueEstimated', 'fiscalDateEnding',
    ];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = headers.join(',') + '\n' +
      events.map(e => headers.map(h => esc((e as any)[h])).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const parts = [
      qFromYear || 'all',
      qToYear || 'all',
      `top${qTopN}`,
      qDirection,
      qMinPct ? `min${qMinPct}` : null,
      qMaxPct ? `max${qMaxPct}` : null,
    ].filter(Boolean);
    a.download = `eps_surprise_${parts.join('_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  const byYear: Record<number, EpsEvent[]> = {};
  for (const e of events) (byYear[e.year] = byYear[e.year] || []).push(e);
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">EPS Surprise — сбор данных</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Универсум — символы из <code>top_n_per_year</code> (тот же «топ», что в Pipeline/Results). Для каждого символа тянем FMP <code>/stable/earnings</code> и сохраняем все квартальные отчёты. Накопительно, без overwrite.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Начальный год</span>
            <input type="number" className="input w-24" value={fromYear} min={2010} max={2030}
                   onChange={e => setFromYear(parseInt(e.target.value) || 2015)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Конечный год</span>
            <input type="number" className="input w-24" value={toYear} min={2010} max={2030}
                   onChange={e => setToYear(parseInt(e.target.value) || 2025)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Top-N</span>
            <input type="number" className="input w-24" value={topNFetch} min={5} max={500}
                   onChange={e => setTopNFetch(parseInt(e.target.value) || 50)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Задержка, мс</span>
            <input type="number" className="input w-24" value={delayMs} min={0} max={2000}
                   onChange={e => setDelayMs(parseInt(e.target.value) || 0)} />
          </label>
          <button className="btn-primary" disabled={running} onClick={runFetch}>
            {running ? 'Идёт сбор...' : '▶ Собрать EPS'}
          </button>
          {status && <span className="text-sm text-blue-600 ml-2">{status}</span>}
        </div>
        <div ref={logRef} className="log mt-3">
          {logLines.length ? logLines.join('\n') : '// логи сбора EPS появятся здесь'}
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">Фильтры (live)</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex flex-col">
            <span className="label">Год от</span>
            <input type="text" className="input w-24" placeholder="—"
                   value={qFromYear} onChange={e => setQFromYear(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Год до</span>
            <input type="text" className="input w-24" placeholder="—"
                   value={qToYear} onChange={e => setQToYear(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Top-N (для среза)</span>
            <input type="number" className="input w-24" value={qTopN} min={1} max={500}
                   onChange={e => setQTopN(parseInt(e.target.value) || 50)} />
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input type="checkbox" checked={qRestrict} onChange={e => setQRestrict(e.target.checked)} />
            <span className="text-sm">Только когда символ в топ-N в год отчёта</span>
          </label>
          <label className="flex flex-col">
            <span className="label">Направление</span>
            <select className="input" value={qDirection} onChange={e => setQDirection(e.target.value as any)}>
              <option value="any">Любое</option>
              <option value="beat">Beat (превзошли)</option>
              <option value="miss">Miss (не оправдали)</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">|Surprise| ≥ %</span>
            <input type="number" className="input w-24" step={0.5} placeholder="—"
                   value={qMinPct} onChange={e => setQMinPct(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">|Surprise| ≤ %</span>
            <input type="number" className="input w-24" step={0.5} placeholder="—"
                   value={qMaxPct} onChange={e => setQMaxPct(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Symbol (опц.)</span>
            <input type="text" className="input w-28" placeholder="AAPL"
                   value={qSymbol} onChange={e => setQSymbol(e.target.value.toUpperCase())} />
          </label>
        </div>
        <div className="mt-3 flex gap-2 items-center flex-wrap">
          <button className="btn-primary" onClick={downloadCsv} disabled={!events.length}>
            Скачать CSV ({events.length})
          </button>
          <button className="btn" onClick={loadEvents} disabled={loading}>Перезагрузить</button>
          {loading && <span className="text-sm text-blue-600">Загрузка...</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          {stats && !loading && (
            <span className="text-sm text-neutral-600">
              {stats.count} отчётов · beat: {stats.beat} · miss: {stats.miss} · flat: {stats.flat}
            </span>
          )}
        </div>
      </section>

      {!events.length && !loading && (
        <section className="card">
          <p className="text-sm text-neutral-600">
            Нет данных. Запустите сбор сверху или ослабьте фильтры. Если таблица пустая — сначала прогоните Pipeline на главной, чтобы появились данные о топ-N.
          </p>
        </section>
      )}

      {years.map(y => (
        <section key={y} className="card">
          <h3 className="font-semibold mb-2">{y} — {byYear[y].length}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-100">
                  <th className="text-left p-2 border">Date</th>
                  <th className="text-left p-2 border">Symbol</th>
                  <th className="text-left p-2 border">Rank</th>
                  <th className="text-left p-2 border">EPS actual</th>
                  <th className="text-left p-2 border">EPS est.</th>
                  <th className="text-left p-2 border">Surprise</th>
                  <th className="text-left p-2 border">Surprise %</th>
                  <th className="text-left p-2 border">Fiscal end</th>
                </tr>
              </thead>
              <tbody>
                {byYear[y].slice(0, 300).map((r, i) => {
                  const pct = r.surprisePct;
                  const beat = (r.surprise ?? 0) > 0;
                  const miss = (r.surprise ?? 0) < 0;
                  return (
                    <tr key={`${r.symbol}-${r.date}-${i}`} className="hover:bg-neutral-50">
                      <td className="p-2 border">{r.date}</td>
                      <td className="p-2 border font-mono">{r.symbol}</td>
                      <td className="p-2 border">{r.rank ?? '—'}</td>
                      <td className="p-2 border font-mono">{r.epsActual != null ? r.epsActual.toFixed(2) : '—'}</td>
                      <td className="p-2 border font-mono">{r.epsEstimated != null ? r.epsEstimated.toFixed(2) : '—'}</td>
                      <td className={`p-2 border font-mono ${beat ? 'text-green-700' : miss ? 'text-red-700' : ''}`}>
                        {r.surprise != null ? (r.surprise > 0 ? '+' : '') + r.surprise.toFixed(2) : '—'}
                      </td>
                      <td className={`p-2 border font-mono ${beat ? 'text-green-700' : miss ? 'text-red-700' : ''}`}>
                        {pct != null ? (pct > 0 ? '+' : '') + pct.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="p-2 border text-xs">{r.fiscalDateEnding ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {byYear[y].length > 300 && (
              <p className="text-xs text-neutral-500 mt-1">
                Показаны первые 300 из {byYear[y].length}. CSV содержит все.
              </p>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
