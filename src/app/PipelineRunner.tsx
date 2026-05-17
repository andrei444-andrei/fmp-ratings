'use client';

import { useState, useRef, useEffect } from 'react';
import { phase0, phase1, phase2, phase2_5 } from '@/lib/pipeline';
import { FOREIGN_ADR } from '@/lib/foreign-adr';

export default function PipelineRunner() {
  const [startYear, setStartYear] = useState(2015);
  const [endYear, setEndYear] = useState(2025);
  const [topN, setTopN] = useState(50);
  const [delayMs, setDelayMs] = useState(120);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogLines(prev => [...prev, `[${ts}] ${msg}`]);
  };
  const progress = (text: string) => setStatus(text);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  async function loadStats() {
    try {
      const res = await fetch('/api/read/stats').then(r => r.json());
      setStats(res);
    } catch (e: any) {
      log(`stats error: ${e.message}`);
    }
  }

  useEffect(() => { loadStats(); }, []);

  async function run() {
    setLogLines([]);
    setRunning(true);
    setStatus('Старт...');
    const t0 = Date.now();
    let runId: number | null = null;
    try {
      const r = await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startYear, endYear, topN }),
      }).then(x => x.json());
      runId = r.id;
      log(`Run #${runId} начат — годы ${startYear}–${endYear}, topN=${topN}, delay=${delayMs}мс`);

      if (endYear < startYear) throw new Error('endYear < startYear');
      const years: number[] = [];
      for (let y = startYear; y <= endYear; y++) years.push(y);

      const membership = await phase0(log, progress, years);
      const topByYear = await phase1(log, progress, years, membership, topN, delayMs);
      await phase2(log, progress, topByYear, delayMs);
      await phase2_5(log, progress, topByYear, delayMs);

      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      log(`✓ Все данные собраны за ${dt}s. Открывайте /results для применения фильтров.`);
      setStatus(`✓ готово за ${dt}s`);
      if (runId) await fetch('/api/runs', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: runId, status: 'completed' }),
      });
    } catch (e: any) {
      log(`PIPELINE ABORT: ${e.message}`);
      setStatus(`Ошибка: ${e.message}`);
      if (runId) await fetch('/api/runs', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: runId, status: 'failed', notes: e.message }),
      });
    } finally {
      setRunning(false);
      loadStats();
    }
  }

  return (
    <div>
      <section className="card">
        <h2 className="font-semibold mb-2">Сбор данных</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Pipeline тянет с FMP <b>все</b> данные (grades, consensus, market cap) и пишет в БД. Фильтрация — на странице <a href="/results" className="underline">Results</a>.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Начальный год</span>
            <input type="number" className="input w-24" value={startYear}
                   onChange={e => setStartYear(parseInt(e.target.value) || 2015)} min={2010} max={2025} />
          </label>
          <label className="flex flex-col">
            <span className="label">Конечный год</span>
            <input type="number" className="input w-24" value={endYear}
                   onChange={e => setEndYear(parseInt(e.target.value) || 2025)} min={2010} max={2025} />
          </label>
          <label className="flex flex-col">
            <span className="label">Top-N (сколько компаний/год)</span>
            <input type="number" className="input w-24" value={topN}
                   onChange={e => setTopN(parseInt(e.target.value) || 50)} min={5} max={500} />
          </label>
          <label className="flex flex-col">
            <span className="label">Задержка между API, мс</span>
            <input type="number" className="input w-24" value={delayMs}
                   onChange={e => setDelayMs(parseInt(e.target.value) || 0)} min={0} max={2000} />
          </label>
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          Universe = (S&P 500 на 31.12 года) ∪ (foreign ADR: {FOREIGN_ADR.length} шт). FMP-ключ из <code>FMP_API_KEY</code> env. Данные не перезаписываются — повторный запуск только добавит недостающее.
        </p>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">Запуск</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <button className="btn-primary" disabled={running} onClick={run}>
            {running ? 'Выполняется...' : '▶ Run pipeline'}
          </button>
          <a className="btn" href="/results">→ Results (с фильтрами)</a>
          <a className="btn" href="/admin">Admin / DB</a>
          {status && <span className="text-sm text-blue-600 ml-2">{status}</span>}
        </div>
        {stats && (
          <div className="mt-3 text-xs text-neutral-600 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(stats).map(([k, v]) => (
              <div key={k} className="bg-neutral-100 rounded px-2 py-1">
                <div className="font-mono">{k}</div>
                <div className="font-semibold">{(v as number)?.toLocaleString?.() ?? v}</div>
              </div>
            ))}
          </div>
        )}
        <div ref={logRef} className="log mt-3">
          {logLines.length ? logLines.join('\n') : '// логи pipeline появятся здесь'}
        </div>
      </section>
    </div>
  );
}
