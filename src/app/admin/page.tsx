'use client';

import { useState, useEffect } from 'react';

const TABLES = [
  'app_errors',
  'sp500_current','sp500_changes','market_cap','grades','consensus_history',
  'top_n_per_year','rating_changes_filtered','runs',
  'prices','research_prompts','research_runs',
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

  useEffect(() => { loadStats(); loadTable(); /* eslint-disable-next-line */ }, []);
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
