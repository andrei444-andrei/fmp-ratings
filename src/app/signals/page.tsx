'use client';

import { useMemo, useRef, useState } from 'react';

const HORIZONS = [1, 2, 3, 4, 5, 6, 7, 14, 21, 42, 63];

type SignalInput = { date: string; symbol: string };

type ReturnsRow = {
  date: string;
  symbol: string;
  symbolReturns: Record<string, number | null>;
  benchmarkReturns: Record<string, number | null> | null;
  error?: string;
};

function parseCsv(text: string): { signals: SignalInput[]; error: string | null } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { signals: [], error: 'Файл пуст' };

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === ',') { cells.push(cur); cur = ''; }
        else if (c === '"') inQ = true;
        else cur += c;
      }
    }
    cells.push(cur);
    return cells.map(s => s.trim());
  };

  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  const dateIdx = header.findIndex(h => h === 'date' || h === 'дата');
  const symIdx = header.findIndex(h => h === 'symbol' || h === 'ticker' || h === 'тикер');
  if (dateIdx < 0 || symIdx < 0) {
    return { signals: [], error: 'В заголовке CSV нужны колонки "date" и "symbol"' };
  }

  const signals: SignalInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    const dateRaw = (cells[dateIdx] || '').trim();
    const sym = (cells[symIdx] || '').trim().toUpperCase();
    if (!dateRaw || !sym) continue;
    let date = dateRaw;
    // допускаем форматы YYYY-MM-DD, YYYY/MM/DD, DD.MM.YYYY
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(date)) date = date.replace(/\//g, '-');
    else if (/^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
      const [d, m, y] = date.split('.');
      date = `${y}-${m}-${d}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    signals.push({ date, symbol: sym });
  }
  if (!signals.length) return { signals: [], error: 'Не удалось извлечь сигналы из CSV' };
  return { signals, error: null };
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const x = v * 100;
  return (x > 0 ? '+' : '') + x.toFixed(2) + '%';
}

function pctColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  if (v > 0) return 'text-green-700';
  if (v < 0) return 'text-red-700';
  return '';
}

export default function SignalsPage() {
  const [fileName, setFileName] = useState<string>('');
  const [signals, setSignals] = useState<SignalInput[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [benchmark, setBenchmark] = useState('');
  const [excludeSignalDay, setExcludeSignalDay] = useState(false);
  const [mode, setMode] = useState<'cumulative' | 'specific'>('cumulative');
  const [fromYear, setFromYear] = useState<string>('');
  const [toYear, setToYear] = useState<string>('');

  const [rows, setRows] = useState<ReturnsRow[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const filteredCount = useMemo(() => {
    const fy = fromYear ? Number(fromYear) : null;
    const ty = toYear ? Number(toYear) : null;
    return signals.filter(s => {
      const y = parseInt(s.date.slice(0, 4));
      if (fy != null && y < fy) return false;
      if (ty != null && y > ty) return false;
      return true;
    }).length;
  }, [signals, fromYear, toYear]);

  const summary = useMemo(() => {
    type Stat = { n: number; avgExcess: number | null; medianExcess: number | null; pctBetter: number | null };
    const out: Record<string, Stat> = {};
    for (const h of HORIZONS) {
      const diffs: number[] = [];
      let better = 0;
      for (const r of rows) {
        if (r.error) continue;
        const s = r.symbolReturns?.[`d${h}`];
        const b = r.benchmarkReturns?.[`d${h}`];
        if (s == null || b == null || !Number.isFinite(s) || !Number.isFinite(b)) continue;
        const d = s - b;
        diffs.push(d);
        if (d > 0) better++;
      }
      if (!diffs.length) {
        out[`d${h}`] = { n: 0, avgExcess: null, medianExcess: null, pctBetter: null };
        continue;
      }
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const sorted = [...diffs].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      out[`d${h}`] = {
        n: diffs.length,
        avgExcess: avg,
        medianExcess: median,
        pctBetter: better / diffs.length,
      };
    }
    return out;
  }, [rows]);

  const hasBenchmarkData = useMemo(
    () => rows.some(r => r.benchmarkReturns && HORIZONS.some(h => r.benchmarkReturns?.[`d${h}`] != null)),
    [rows],
  );

  function onFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setSignals([]);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const { signals, error } = parseCsv(text);
      if (error) { setParseError(error); setSignals([]); }
      else setSignals(signals);
    };
    reader.onerror = () => setParseError('Не удалось прочитать файл');
    reader.readAsText(file);
  }

  async function run() {
    if (!signals.length) { setError('Сначала загрузите CSV'); return; }
    setError(null);
    setRows([]);
    setProgress({ processed: 0, total: filteredCount });
    setRunning(true);
    setStatus('Подключение...');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/signals/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          signals,
          benchmark: benchmark.trim() || null,
          excludeSignalDay,
          mode,
          fromYear: fromYear ? Number(fromYear) : null,
          toYear: toYear ? Number(toYear) : null,
        }),
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg: any;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.type === 'start') {
            setStatus(`Старт: ${msg.total} сигналов`);
            setProgress({ processed: 0, total: msg.total });
          } else if (msg.type === 'row') {
            setRows(prev => [...prev, {
              date: msg.date,
              symbol: msg.symbol,
              symbolReturns: msg.symbolReturns || {},
              benchmarkReturns: msg.benchmarkReturns ?? null,
              error: msg.error,
            }]);
          } else if (msg.type === 'progress') {
            setProgress({ processed: msg.processed, total: msg.total });
            setStatus(`Обработано ${msg.processed}/${msg.total}`);
          } else if (msg.type === 'warning') {
            setStatus(`⚠ ${msg.message}`);
          } else if (msg.type === 'done') {
            setStatus(`✓ Готово: ${msg.processed} строк`);
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') setStatus('Отменено');
      else setError(e?.message || 'Ошибка стрима');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function downloadCsv() {
    const headers = ['date', 'symbol', ...HORIZONS.map(h => `d${h}`)];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.join(',')];
    for (const r of rows) {
      const cells = [r.date, r.symbol];
      for (const h of HORIZONS) {
        const s = r.symbolReturns?.[`d${h}`];
        const b = r.benchmarkReturns?.[`d${h}`];
        const sTxt = s == null ? '' : (s * 100).toFixed(4) + '%';
        const bTxt = b == null ? '' : (b * 100).toFixed(4) + '%';
        cells.push(b !== undefined && r.benchmarkReturns ? `${sTxt} (${bTxt})` : sTxt);
      }
      lines.push(cells.map(esc).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `signal_returns_${mode}_${excludeSignalDay ? 'exclD0' : 'inclD0'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">Оценка эффективности сигналов</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Загрузите CSV с колонками <code>date</code> и <code>symbol</code>. Для каждого сигнала
          считаем доходность тикера на торговых горизонтах 1, 2, 3, 4, 5, 6, 7, 14, 21, 42, 63 дня.
          Если указан бенчмарк — в скобках показывается его доходность за тот же период.
        </p>

        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex flex-col">
            <span className="label">CSV файл</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              className="text-sm"
            />
          </label>
          <label className="flex flex-col">
            <span className="label">Бенчмарк (опц.)</span>
            <input type="text" className="input w-28" placeholder="SPY"
                   value={benchmark} onChange={e => setBenchmark(e.target.value.toUpperCase())} />
          </label>
          <label className="flex flex-col">
            <span className="label">Год от</span>
            <input type="text" className="input w-24" placeholder="—"
                   value={fromYear} onChange={e => setFromYear(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Год до</span>
            <input type="text" className="input w-24" placeholder="—"
                   value={toYear} onChange={e => setToYear(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input type="checkbox" checked={excludeSignalDay}
                   onChange={e => setExcludeSignalDay(e.target.checked)} />
            <span className="text-sm">Исключить день сигнала</span>
          </label>
          <label className="flex flex-col">
            <span className="label">Доходность</span>
            <select className="input" value={mode} onChange={e => setMode(e.target.value as any)}>
              <option value="cumulative">Накопительно</option>
              <option value="specific">В конкретный день</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <button className="btn-primary" disabled={running || !signals.length} onClick={run}>
            {running ? 'Идёт расчёт...' : '▶ Рассчитать'}
          </button>
          {running && <button className="btn" onClick={cancel}>Отменить</button>}
          <button className="btn" disabled={!rows.length} onClick={downloadCsv}>
            Скачать CSV ({rows.length})
          </button>
          <span className="text-sm text-neutral-600">
            {fileName && <>файл: <code>{fileName}</code> · </>}
            сигналов в файле: {signals.length}
            {(fromYear || toYear) && <> · в диапазоне: {filteredCount}</>}
          </span>
          {progress && (
            <span className="text-sm text-blue-600">
              {progress.processed}/{progress.total}
            </span>
          )}
          {status && <span className="text-sm text-neutral-600">{status}</span>}
          {parseError && <span className="text-sm text-red-600">{parseError}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </section>

      <section className="card">
        <div className="flex justify-between items-baseline mb-2">
          <h3 className="font-semibold">Результаты ({rows.length})</h3>
          <span className="text-xs text-neutral-500">
            режим: {mode === 'cumulative' ? 'накопительно' : 'в конкретный день'}
            {excludeSignalDay ? ', без дня сигнала' : ', с дня сигнала'}
            {benchmark && <> · бенчмарк: <code>{benchmark}</code></>}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-100">
                <th className="text-left p-2 border">Date</th>
                <th className="text-left p-2 border">Symbol</th>
                {HORIZONS.map(h => (
                  <th key={h} className="text-right p-2 border whitespace-nowrap">{h} day</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.symbol}-${r.date}-${i}`} className="hover:bg-neutral-50">
                  <td className="p-2 border whitespace-nowrap">{r.date}</td>
                  <td className="p-2 border font-mono">
                    {r.symbol}
                    {r.error && <span className="text-red-600 text-xs ml-1">({r.error})</span>}
                  </td>
                  {HORIZONS.map(h => {
                    const s = r.symbolReturns?.[`d${h}`];
                    const b = r.benchmarkReturns?.[`d${h}`];
                    return (
                      <td key={h} className="p-2 border font-mono text-right whitespace-nowrap text-xs">
                        <span className={pctColor(s)}>{fmtPct(s)}</span>
                        {r.benchmarkReturns && (
                          <span className="text-neutral-500"> ({fmtPct(b)})</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={2 + HORIZONS.length} className="p-3 text-center text-neutral-500 text-sm">
                    Нет данных. Загрузите CSV и нажмите «Рассчитать».
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <div className="flex justify-between items-baseline mb-2">
            <h3 className="font-semibold">Summary — превышение бенчмарка</h3>
            <span className="text-xs text-neutral-500">
              {benchmark
                ? <>бенчмарк: <code>{benchmark}</code> · excess = доходность тикера − доходность бенчмарка</>
                : 'бенчмарк не задан — статистика недоступна'}
            </span>
          </div>
          {hasBenchmarkData ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-100">
                    <th className="text-left p-2 border">Метрика</th>
                    {HORIZONS.map(h => (
                      <th key={h} className="text-right p-2 border whitespace-nowrap">{h} day</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="p-2 border">Среднее превышение бенчмарка</td>
                    {HORIZONS.map(h => {
                      const v = summary[`d${h}`]?.avgExcess;
                      return (
                        <td key={h} className={`p-2 border font-mono text-right whitespace-nowrap ${pctColor(v)}`}>
                          {fmtPct(v)}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="p-2 border">Медианное превышение бенчмарка</td>
                    {HORIZONS.map(h => {
                      const v = summary[`d${h}`]?.medianExcess;
                      return (
                        <td key={h} className={`p-2 border font-mono text-right whitespace-nowrap ${pctColor(v)}`}>
                          {fmtPct(v)}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="p-2 border">% сделок лучше бенчмарка</td>
                    {HORIZONS.map(h => {
                      const v = summary[`d${h}`]?.pctBetter;
                      const cls = v == null ? '' : v > 0.5 ? 'text-green-700' : v < 0.5 ? 'text-red-700' : '';
                      return (
                        <td key={h} className={`p-2 border font-mono text-right whitespace-nowrap ${cls}`}>
                          {v == null ? '—' : (v * 100).toFixed(1) + '%'}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="text-xs text-neutral-500">
                    <td className="p-2 border">N (учтено сделок)</td>
                    {HORIZONS.map(h => (
                      <td key={h} className="p-2 border font-mono text-right whitespace-nowrap">
                        {summary[`d${h}`]?.n ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">
              Чтобы увидеть статистику превышения, укажите бенчмарк и повторите расчёт.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
