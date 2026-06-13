'use client';

import { useEffect, useMemo, useState } from 'react';
import EquityChart, { type ChartLine } from './EquityChart';
import { computeSummary } from '@/lib/quantconnect/summary';
import type { SeriesResponse } from '@/lib/quantconnect/types';

const ACC = '#6b5bf0', MUT = '#9aa0ad';
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100; const s = p > 0 ? '+' : p < 0 ? '−' : '';
  return s + Math.abs(p).toFixed(d) + '%';
}
function num(v: number | null | undefined, d = 2): string { return v == null || !isFinite(v) ? '—' : v.toFixed(d); }
function cls(v: number | null | undefined): string { if (v == null || !isFinite(v) || v === 0) return 'qc-mut'; return v > 0 ? 'qc-pos' : 'qc-neg'; }
function heatBg(r: number): string {
  const a = Math.min(Math.abs(r) / 0.10, 1) * 0.6;
  return r >= 0 ? `rgba(15,157,99,${a})` : `rgba(219,59,68,${a})`;
}

export default function StrategySummary({ includeArchived }: { includeArchived: boolean }) {
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
  const sum = useMemo(() => {
    if (!series || !algo) return null;
    return computeSummary(algo.daily, series.benchmark?.daily || null);
  }, [series, algo]);

  const chart = useMemo(() => {
    if (!sum || !sum.dates.length) return null;
    const N = sum.equity.length, stride = Math.max(1, Math.ceil(N / 520));
    const idx: number[] = [];
    for (let i = 0; i < N; i += stride) idx.push(i);
    if (idx[idx.length - 1] !== N - 1) idx.push(N - 1);
    const sample = (arr: number[] | null) => (arr ? idx.map(i => arr[i]) : null);
    const lines: ChartLine[] = [{ label: 'Стратегия', color: ACC, values: sample(sum.equity)! }];
    const be = sample(sum.benchEquity);
    if (be) lines.push({ label: series?.benchmark?.name || 'SPY', color: MUT, values: be, dash: true });
    const xTicks: { pos: number; text: string }[] = [];
    let last = '';
    idx.forEach((o, s) => { const y = sum.dates[Math.min(o, sum.dates.length - 1)].slice(0, 4); if (y !== last) { xTicks.push({ pos: s, text: y }); last = y; } });
    return { lines, xTicks };
  }, [sum, series]);

  if (loading && !series) return <div className="qc-panel"><div className="qc-state">Загрузка дневных рядов…</div></div>;

  const years = sum ? [...new Set([...Object.keys(sum.monthly).map(Number), ...Object.keys(sum.yearlyTotals).map(Number)])].sort((a, b) => a - b) : [];

  return (
    <>
      <div className="qc-method">
        <h4>Сводка по стратегии</h4>
        <ul>
          <li>Ключевые метрики, кривая капитала против SPY и помесячная доходность (heatmap) — по одной стратегии.</li>
          <li><b>Sharpe/Sortino</b> — по месячным доходностям (год.); <b>просадка</b> — реальная дневная; <b>Calmar</b> = CAGR / |просадка|.</li>
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

          {!sum ? (
            <div className="qc-panel"><div className="qc-state">Недостаточно данных по стратегии.</div></div>
          ) : (
            <>
              <div className="qc-cards">
                <Card k="CAGR" v={fmtPct(sum.cagr)} cls={cls(sum.cagr)} sub={`${sum.years.toFixed(1)} лет`} />
                <Card k="Итоговая доходность" v={fmtPct(sum.total)} cls={cls(sum.total)} />
                <Card k="Макс. просадка (дн.)" v={fmtPct(sum.maxDD)} cls={cls(sum.maxDD)} sub={sum.maxDDPeak ? `${sum.maxDDPeak} → ${sum.maxDDTrough}` : undefined} />
                <Card k="Sharpe" v={num(sum.sharpe)} />
                <Card k="Sortino" v={num(sum.sortino)} />
                <Card k="Calmar" v={num(sum.calmar)} />
                <Card k="σ доходности / год" v={sum.volAnn != null ? (sum.volAnn * 100).toFixed(1) + '%' : '—'} />
                <Card k="Положит. месяцев" v={sum.posMonths != null ? Math.round(sum.posMonths * 100) + '%' : '—'} sub={sum.bestMonth ? `лучш ${fmtPct(sum.bestMonth.r)} / худш ${fmtPct(sum.worstMonth?.r)}` : undefined} />
              </div>

              {chart && (
                <div className="qc-panel">
                  <div className="qc-panel-h">Кривая капитала <span className="c">лог-шкала, старт ×1</span>
                    <span className="qc-spacer" />
                    <span className="qc-legend"><span className="ln" style={{ background: ACC }} />Стратегия</span>
                    {sum.benchEquity && <span className="qc-legend"><span className="ln" style={{ background: MUT }} />{series?.benchmark?.name}</span>}
                  </div>
                  <EquityChart lines={chart.lines} xTicks={chart.xTicks} height={300} />
                </div>
              )}

              {/* помесячный heatmap */}
              <div className="qc-panel">
                <div className="qc-panel-h">Помесячная доходность</div>
                <div className="qc-tblwrap" style={{ border: 0 }}>
                  <table className="qc-heat">
                    <thead><tr><th className="lbl">Год</th>{MONTHS.map(m => <th key={m}>{m}</th>)}<th className="tot">Год</th></tr></thead>
                    <tbody>
                      {years.map(y => (
                        <tr key={y}>
                          <td className="lbl">{y}</td>
                          {MONTHS.map((_, mi) => {
                            const r = sum.monthly[y]?.[mi + 1];
                            return <td key={mi} style={{ background: r != null ? heatBg(r) : 'transparent' }}>{r != null ? fmtPct(r) : ''}</td>;
                          })}
                          <td className={'tot ' + cls(sum.yearlyTotals[y])}>{sum.yearlyTotals[y] != null ? fmtPct(sum.yearlyTotals[y]) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Card({ k, v, sub, cls: c }: { k: string; v: string; sub?: string; cls?: string }) {
  return (
    <div className="qc-card">
      <div className="qc-card-k">{k}</div>
      <div className={'qc-card-v ' + (c || '')}>{v}</div>
      {sub && <div className="qc-card-sub">{sub}</div>}
    </div>
  );
}
