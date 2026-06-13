'use client';

import { useEffect, useMemo, useState } from 'react';
import { computeRisk, type CorrMethod, type ReturnsResolution } from '@/lib/quantconnect/risk';
import { QC_STATUS_LABEL, type SeriesResponse } from '@/lib/quantconnect/types';

function f2(v: number | null | undefined): string { return v == null || !isFinite(v) ? '—' : v.toFixed(2); }
function pctU(v: number | null | undefined, d = 0): string { return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%'; }
function sharpeFmt(v: number | null | undefined): string { return v == null || !isFinite(v) ? '—' : v.toFixed(2); }
function clsR(v: number | null | undefined): string { if (v == null || !isFinite(v) || v === 0) return 'qc-mut'; return v > 0 ? 'qc-pos' : 'qc-neg'; }

// Цвет ячейки корреляции: высокая (+) — красная (избыточность), низкая/отрицательная — зелёная (диверсификатор).
function corrBg(r: number): string {
  const a = Math.min(Math.abs(r), 1) * 0.5;
  return r >= 0 ? `rgba(219,59,68,${a})` : `rgba(15,157,99,${a})`;
}

const RES: { k: ReturnsResolution; label: string }[] = [{ k: 'M', label: 'Месяц' }, { k: 'W', label: 'Неделя' }, { k: 'D', label: 'День' }];

export default function RiskCorrelation({ includeArchived }: { includeArchived: boolean }) {
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [res, setRes] = useState<ReturnsResolution>('M');
  const [method, setMethod] = useState<CorrMethod>('pearson');

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

  useEffect(() => {
    if (!series) return;
    setInclude(prev => { const n = { ...prev }; for (const a of series.algos) if (n[a.id] === undefined) n[a.id] = !a.error && a.daily.length >= 8; return n; });
  }, [series]);

  const usable = (series?.algos || []).filter(a => !a.error && a.daily.length >= 8);
  const result = useMemo(() => {
    if (!series) return null;
    const inputs = usable.filter(a => include[a.id]).map(a => ({ id: a.id, name: a.name, daily: a.daily }));
    return computeRisk(inputs, series.benchmark?.daily || null, res, method);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, include, res, method]);

  if (loading && !series) return <div className="qc-panel"><div className="qc-state">Загрузка дневных рядов…</div></div>;

  const resLabel = res === 'M' ? 'месячные' : res === 'W' ? 'недельные' : 'дневные';

  return (
    <>
      <div className="qc-method">
        <h4>Риск и корреляция</h4>
        <ul>
          <li>Корреляции считаются по <b>доходностям</b> (не по кривой капитала) на общем периоде выбранных стратегий.</li>
          <li>Ячейка <b className="qc-neg">красная</b> — высокая корреляция (дублирование), <b className="qc-pos">зелёная</b> — низкая/отрицательная (диверсификатор).</li>
          <li><b>ENB</b> — сколько у портфеля реально независимых ставок; <b>доля 1-й компоненты</b> — насколько всё сводится к одному фактору; <b>div. ratio</b> &gt; 1 — выгода диверсификации.</li>
          <li><b>Вклад в диверсификацию</b>: стратегия улучшает портфель, если её Sharpe &gt; ρ · Sharpe остальных (правило Sᵢ &gt; ρ·S_rest).</li>
        </ul>
      </div>

      {usable.length < 2 ? (
        <div className="qc-panel"><div className="qc-state">
          Нужно минимум 2 стратегии с данными. {error && <div className="qc-err" style={{ marginTop: 8 }}>{error}</div>}
        </div></div>
      ) : (
        <>
          <div className="qc-controls-bar">
            <span className="qc-seg">{RES.map(r => <button key={r.k} className={res === r.k ? 'on' : ''} onClick={() => setRes(r.k)}>{r.label}</button>)}</span>
            <span className="qc-seg">
              <button className={method === 'pearson' ? 'on' : ''} onClick={() => setMethod('pearson')}>Pearson</button>
              <button className={method === 'spearman' ? 'on' : ''} onClick={() => setMethod('spearman')}>Ранговая</button>
            </span>
            <span className="qc-spacer" />
            <button className="qc-btn" onClick={() => load(true)} disabled={loading} title="Пересчитать, минуя кэш">Пересчитать</button>
          </div>

          {/* выбор стратегий */}
          <div className="qc-chiplist" style={{ marginBottom: 14 }}>
            {(series?.algos || []).map(a => {
              const ok = !a.error && a.daily.length >= 8;
              return (
                <label key={a.id} className={'qc-chip' + (ok ? '' : ' arch')} style={{ cursor: ok ? 'pointer' : 'default', paddingLeft: 8 }} title={ok ? '' : (a.error || 'нет данных')}>
                  <input type="checkbox" disabled={!ok} checked={!!include[a.id] && ok} onChange={e => setInclude(prev => ({ ...prev, [a.id]: e.target.checked }))}
                    style={{ accentColor: 'var(--qc-acc)', marginRight: 6 }} />
                  {a.name}
                </label>
              );
            })}
          </div>

          {!result ? (
            <div className="qc-panel"><div className="qc-state">Недостаточно общего периода у выбранных стратегий (нужно ≥3 точки). Попробуйте другое разрешение или набор.</div></div>
          ) : (
            <>
              <div className="qc-cards">
                <Card k="Наблюдений" v={`${result.obs}`} sub={`${resLabel} доходности`} />
                <Card k="Ср. корреляция" v={f2(result.avgCorr)} cls={result.avgCorr != null ? (result.avgCorr < 0.3 ? 'qc-pos' : result.avgCorr > 0.6 ? 'qc-neg' : '') : ''} sub="ниже = лучше" />
                <Card k="ENB" v={result.enb != null ? result.enb.toFixed(1) : '—'} sub={`из ${result.ids.length} стратегий`} />
                <Card k="1-я компонента" v={pctU(result.pc1)} sub="доля общей дисперсии" />
                <Card k="Diversification ratio" v={f2(result.divRatio)} sub="> 1 — есть выгода" />
              </div>

              <CorrTable title={`Корреляция доходностей (${resLabel})`} labels={result.names} m={result.corr} />

              {/* по стратегиям */}
              <div className="qc-tblwrap" style={{ marginBottom: 16 }}>
                <table className="qc-matrix">
                  <thead><tr className="groups">
                    <th className="yr">Стратегия</th><th>Sharpe</th><th>σ / год</th><th>ρ ср.</th><th>ρ с SPY</th><th>Вклад в диверс.</th>
                  </tr></thead>
                  <tbody>
                    {result.perStrategy.map(s => (
                      <tr key={s.id}>
                        <td className="yr">{s.name}</td>
                        <td className={clsR(s.sharpe)}>{sharpeFmt(s.sharpe)}</td>
                        <td>{pctU(s.vol, 1)}</td>
                        <td className={s.avgCorr != null && s.avgCorr < 0.3 ? 'qc-pos' : s.avgCorr != null && s.avgCorr > 0.6 ? 'qc-neg' : 'qc-mut'}>{f2(s.avgCorr)}</td>
                        <td className="qc-mut">{f2(s.corrBench)}</td>
                        <td className={s.improves == null ? 'qc-mut' : s.improves ? 'qc-pos' : 'qc-neg'} title="Sᵢ > ρ·S_rest">
                          {s.improves == null ? '—' : s.improves ? '✓ да' : '✗ нет'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* downside */}
              {result.downCorr ? (
                <CorrTable title={`Корреляция в падения рынка · SPY < 0 (${result.downObs} периодов)`} labels={result.names} m={result.downCorr} />
              ) : (
                <div className="qc-panel"><div className="qc-state" style={{ padding: 18 }}>
                  Downside-корреляция: недостаточно падающих периодов ({result.downObs}) для оценки.
                </div></div>
              )}
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

function CorrTable({ title, labels, m }: { title: string; labels: string[]; m: number[][] }) {
  const short = (s: string) => (s.length > 16 ? s.slice(0, 15) + '…' : s);
  return (
    <div className="qc-panel">
      <div className="qc-panel-h">{title}</div>
      <div className="qc-tblwrap" style={{ border: 0 }}>
        <table className="qc-corr">
          <thead>
            <tr><th className="lbl"></th>{labels.map((l, j) => <th key={j} title={l}>{short(l)}</th>)}</tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={i}>
                <td className="lbl" title={l}>{short(l)}</td>
                {labels.map((_, j) => (
                  <td key={j} style={{ background: i === j ? 'var(--qc-surf2)' : corrBg(m[i][j]) }}>
                    {i === j ? '—' : (m[i][j] == null || !isFinite(m[i][j]) ? '—' : m[i][j].toFixed(2))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
