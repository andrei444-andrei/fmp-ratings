'use client';

import { useEffect, useMemo, useState } from 'react';
import UnderwaterChart from './UnderwaterChart';
import { computeDrawdowns, type DrawdownResult } from '@/lib/quantconnect/drawdowns';
import type { SeriesResponse } from '@/lib/quantconnect/types';

function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100; const s = p > 0 ? '+' : p < 0 ? '−' : '';
  return s + Math.abs(p).toFixed(d) + '%';
}
function days(n: number | null): string {
  if (n == null) return '—';
  if (n < 31) return `${n} дн`;
  const m = Math.round(n / 30.4);
  return m < 18 ? `${m} мес` : `${(n / 365.25).toFixed(1)} г`;
}

export default function DrawdownAnalysis({ includeArchived }: { includeArchived: boolean }) {
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  async function load(force = false) {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (force) qs.set('force', '1');
      if (includeArchived) qs.set('archived', '1');
      const r: SeriesResponse = await fetch(`/api/quantconnect/series?${qs}`).then(res => res.json());
      if (r.error) setError(r.error);
      setSeries(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [includeArchived]);

  const usable = (series?.algos || []).filter(a => !a.error && a.daily.length >= 20);
  useEffect(() => {
    if (usable.length && (sel == null || !usable.some(a => a.id === sel))) setSel(usable[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  const algo = usable.find(a => a.id === sel) || null;
  const dd = useMemo(() => (algo ? computeDrawdowns(algo.daily) : null), [algo]);

  if (loading && !series) return <div className="qc-panel"><div className="qc-state">Загрузка дневных рядов…</div></div>;

  return (
    <>
      <div className="qc-method">
        <h4>Анализ просадок</h4>
        <ul>
          <li><b>Underwater</b> — насколько капитал ниже исторического пика в каждый день (всегда дневная точность).</li>
          <li>Таблица: каждый эпизод просадки — пик → дно → восстановление, глубина, время падения и восстановления.</li>
        </ul>
      </div>

      {usable.length === 0 ? (
        <div className="qc-panel"><div className="qc-state">
          Нет стратегий с дневными данными. {error && <div className="qc-err" style={{ marginTop: 8 }}>{error}</div>}
        </div></div>
      ) : (
        <>
          <div className="qc-controls-bar">
            <label className="qc-toggle">Стратегия:&nbsp;
              <select className="qc-select" style={{ width: 'auto' }} value={sel ?? ''} onChange={e => setSel(Number(e.target.value))}>
                {usable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <span className="qc-spacer" />
            <button className="qc-btn" onClick={() => load(true)} disabled={loading} title="Пересчитать, минуя кэш">Пересчитать</button>
          </div>

          {!dd ? (
            <div className="qc-panel"><div className="qc-state">Недостаточно данных по стратегии.</div></div>
          ) : (
            <>
              <div className="qc-panel">
                <div className="qc-panel-h">Underwater (% ниже пика) <span className="c">макс. просадка {fmtPct(dd.maxDD)}</span></div>
                <UnderwaterChart dates={dd.dates} lines={[{ label: 'Просадка', color: '#db3b44', uw: dd.underwater, fill: true }]} height={260} />
              </div>

              <div className="qc-tblwrap">
                <table className="qc-matrix">
                  <thead><tr className="groups">
                    <th className="yr">#</th><th>Глубина</th><th>Пик</th><th>Дно</th><th>Восстановление</th><th>Падение</th><th>Восст-е</th><th>Всего</th>
                  </tr></thead>
                  <tbody>
                    {dd.episodes.slice(0, 10).map((e, i) => (
                      <tr key={i}>
                        <td className="yr">{i + 1}</td>
                        <td className="qc-neg">{fmtPct(e.depth)}</td>
                        <td className="qc-mut">{e.peak}</td>
                        <td className="qc-mut">{e.trough}</td>
                        <td className={e.recovered ? 'qc-mut' : 'qc-neg'}>{e.recovery ?? 'не восстановилась'}</td>
                        <td>{days(e.ddDays)}</td>
                        <td>{days(e.recoveryDays)}</td>
                        <td>{days(e.lengthDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
