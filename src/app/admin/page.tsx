'use client';

import { useState, useEffect } from 'react';

const TABLES = [
  'app_errors',
  'sp500_current','sp500_changes','market_cap','grades','consensus_history',
  'top_n_per_year','rating_changes_filtered','runs',
  'prices','research_prompts','research_runs','fundamentals','dividends',
  'qc_algorithms','qc_backtest_cache','naaim_exposure',
];

export default function AdminPage() {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [table, setTable] = useState('top_n_per_year');
  const [limit, setLimit] = useState(100);
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [sql, setSql] = useState('SELECT year, COUNT(*) AS n FROM rating_changes_filtered GROUP BY year ORDER BY year');
  const [queryResult, setQueryResult] = useState<{ columns: string[]; rows: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  // NAAIM Exposure Index — ручной ингест истории/еженедельных значений для вкладки «NAAIM» в /signals.
  const [naaimStatus, setNaaimStatus] = useState<{ count: number; first: string; last: string; source: string } | null>(null);
  const [naaimText, setNaaimText] = useState('');
  const [naaimMsg, setNaaimMsg] = useState<string | null>(null);
  const [naaimBusy, setNaaimBusy] = useState(false);

  async function loadNaaim() {
    try {
      const d = await fetch('/api/admin/naaim').then(r => r.json());
      if (d?.ok) setNaaimStatus({ count: d.count, first: d.first, last: d.last, source: d.source });
    } catch { /* noop */ }
  }
  async function ingestNaaim() {
    setNaaimBusy(true);
    setNaaimMsg(null);
    try {
      const r = await fetch('/api/admin/naaim', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: naaimText });
      const d = await r.json();
      if (!d.ok) setNaaimMsg(`Ошибка: ${d.error || 'не удалось'}`);
      else { setNaaimMsg(`✓ Загружено: ${d.count} недель (${d.first} … ${d.last})`); setNaaimText(''); loadNaaim(); loadStats(); }
    } catch (e: any) {
      setNaaimMsg(`Ошибка: ${e.message}`);
    } finally {
      setNaaimBusy(false);
    }
  }

  async function loadStats() {
    const data = await fetch('/api/read/stats').then(r => r.json());
    setStats(data);
  }

  async function runMigrations() {
    setMigrating(true);
    setMigrateMsg(null);
    try {
      const r = await fetch('/api/admin/migrate', { method: 'POST' });
      const data = await r.json();
      if (data.error) setMigrateMsg(`Ошибка: ${data.error}`);
      else setMigrateMsg('✓ Миграции применены');
      loadStats();
    } catch (e: any) {
      setMigrateMsg(`Ошибка: ${e.message}`);
    } finally {
      setMigrating(false);
    }
  }
  async function loadTable() {
    setError(null);
    const data = await fetch(`/api/admin/table?table=${table}&limit=${limit}`).then(r => r.json());
    if (data.error) { setError(data.error); return; }
    setColumns(data.columns);
    setRows(data.rows);
  }
  async function runQuery() {
    setError(null);
    const r = await fetch('/api/admin/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const data = await r.json();
    if (data.error) { setError(data.error); setQueryResult(null); return; }
    setQueryResult(data);
  }

  function downloadTableCsv() {
    if (!columns.length || !rows.length) return;
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = columns.join(',') + '\n' + rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${table}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  useEffect(() => { loadStats(); loadTable(); loadNaaim(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadTable(); /* eslint-disable-next-line */ }, [table, limit]);

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">Stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} className="bg-neutral-100 rounded px-3 py-2">
              <div className="font-mono text-xs">{k}</div>
              <div className="font-semibold">{v?.toLocaleString?.() ?? v}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2 items-center flex-wrap">
          <button className="btn" onClick={loadStats}>Обновить</button>
          <button className="btn-primary" onClick={runMigrations} disabled={migrating}>
            {migrating ? 'Применяю миграции...' : 'Run DB migrations'}
          </button>
          {migrateMsg && <span className="text-sm">{migrateMsg}</span>}
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          Нажмите «Run DB migrations» один раз после подключения Turso через Vercel Marketplace — создаст таблицы.
        </p>
        <div className="mt-3 flex gap-2 items-center flex-wrap">
          <a className="btn" href="/admin/quantconnect">QuantConnect — креды доступа</a>
          <a className="btn" href="/quant">Аналитика алгоритмов</a>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">NAAIM Exposure Index — данные для вкладки «NAAIM» в /signals</h2>
        <p className="text-xs text-neutral-600 mb-2">
          Источник сейчас: <b>{naaimStatus ? (naaimStatus.source || '—') : '…'}</b>
          {naaimStatus?.count
            ? ` · ${naaimStatus.count} недель (${naaimStatus.first} … ${naaimStatus.last})`
            : ' · реальных данных ещё нет (вкладка считает на синтетике)'}
        </p>
        <textarea
          className="input w-full font-mono text-xs"
          rows={6}
          placeholder={'Вставьте историю — по одной строке на неделю:\n2006-01-04,40.00\n2006-01-11,55.50\n2006-01-18,61.30\n…'}
          value={naaimText}
          onChange={e => setNaaimText(e.target.value)}
        />
        <div className="mt-2 flex gap-2 items-center flex-wrap">
          <button className="btn-primary" onClick={ingestNaaim} disabled={naaimBusy || !naaimText.trim()}>
            {naaimBusy ? 'Загружаю…' : 'Загрузить (upsert)'}
          </button>
          <button className="btn" onClick={loadNaaim}>Обновить статус</button>
          {naaimMsg && <span className="text-sm">{naaimMsg}</span>}
        </div>
        <div className="text-xs text-neutral-500 mt-2 space-y-1">
          <p><b>Формат:</b> <code>ГГГГ-ММ-ДД,значение</code> — одна неделя на строку (понимаются и даты вида MM/DD/YYYY, разделители «,» «;» таб). Повторная загрузка обновляет недели по дате (upsert) — каждый четверг можно вставлять одну новую строку, ничего не дублируется.</p>
          <p><b>Где брать:</b> официальный источник — <a className="underline" href="https://naaim.org/programs/naaim-exposure-index/" target="_blank" rel="noreferrer">naaim.org → NAAIM Exposure Index</a>. Новое значение выходит <b>по четвергам</b> (опрос закрывается в среду); там же исторический график для разовой заливки. Прямого файла для скачивания сайт не отдаёт (график рисуется на клиенте).</p>
          <p><b>Без ручной работы:</b> задайте переменную окружения <code>NAAIM_CSV_URL</code> на прямой CSV/JSON-фид (<code>date,value</code>) — вкладка подтянет данные сама (best-effort, кэш в БД).</p>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">Browse table</h2>
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex flex-col">
            <span className="label">Таблица</span>
            <select className="input" value={table} onChange={e => setTable(e.target.value)}>
              {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Limit</span>
            <input type="number" className="input" value={limit}
                   onChange={e => setLimit(parseInt(e.target.value) || 100)} min={1} max={1000} />
          </label>
          <button className="btn" onClick={loadTable}>Обновить</button>
          <button className="btn" onClick={downloadTableCsv} disabled={!rows.length}>Скачать CSV</button>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <div className="overflow-x-auto mt-3 max-h-96">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-neutral-100">
                {columns.map(c => <th key={c} className="text-left p-1.5 border">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-neutral-50">
                  {columns.map(c => <td key={c} className="p-1.5 border font-mono">{r[c] == null ? '' : String(r[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-500 mt-1">Показано: {rows.length}</p>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">SQL console (read-only)</h2>
        <textarea
          className="input w-full font-mono text-xs"
          rows={4}
          value={sql}
          onChange={e => setSql(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button className="btn-primary" onClick={runQuery}>Run query</button>
          <span className="text-xs text-neutral-500 self-center">Разрешены только SELECT / WITH / EXPLAIN / PRAGMA.</span>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        {queryResult && (
          <div className="overflow-x-auto mt-3 max-h-96">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-neutral-100">
                  {queryResult.columns.map(c => <th key={c} className="text-left p-1.5 border">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {queryResult.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-neutral-50">
                    {queryResult.columns.map(c => <td key={c} className="p-1.5 border font-mono">{r[c] == null ? '' : String(r[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-neutral-500 mt-1">{queryResult.rows.length} строк</p>
          </div>
        )}
      </section>
    </main>
  );
}
