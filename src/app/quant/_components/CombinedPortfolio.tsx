'use client';

import { useEffect, useMemo, useState } from 'react';
import EquityChart, { type ChartLine } from './EquityChart';
import { combinePortfolio } from '@/lib/quantconnect/combine';
import { QC_STATUS_LABEL, type SeriesResponse, type YearMetric } from '@/lib/quantconnect/types';

function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100; const s = p > 0 ? '+' : p < 0 ? '−' : '';
  return s + Math.abs(p).toFixed(d) + '%';
}
function cls(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return 'qc-mut';
  return v > 0 ? 'qc-pos' : 'qc-neg';
}
const ACC = '#6b5bf0', MUT = '#9aa0ad';

export default function CombinedPortfolio({ includeArchived }: { includeArchived: boolean }) {
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [weights, setWeights] = useState<Record<number, number>>({});

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

  // дефолты include/weights для новых стратегий
  useEffect(() => {
    if (!series) return;
    setInclude(prev => {
      const n = { ...prev };
      for (const a of series.algos) if (n[a.id] === undefined) n[a.id] = !a.error && a.monthly.length >= 2;
      return n;
    });
    setWeights(prev => {
      const n = { ...prev };
      for (const a of series.algos) if (n[a.id] === undefined) n[a.id] = 1;
      return n;
    });
  }, [series]);

  const usable = (series?.algos || []).filter(a => !a.error && a.monthly.length >= 2);
  const includedW = usable.filter(a => include[a.id]).reduce((s, a) => s + (weights[a.id] ?? 1), 0) || 1;

  const combined = useMemo(() => {
    if (!series) return null;
    const inputs = usable
      .filter(a => include[a.id])
      .map(a => ({ id: a.id, monthly: a.monthly, weight: weights[a.id] ?? 1 }));
    return combinePortfolio(inputs, series.benchmark?.monthly || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, include, weights]);

  const chart = useMemo(() => {
    if (!combined || !combined.months.length) return null;
    const lines: ChartLine[] = [{ label: 'Портфель', color: ACC, values: combined.equity }];
    if (combined.benchEquity) lines.push({ label: series?.benchmark?.name || 'Бенчмарк', color: MUT, values: combined.benchEquity, dash: true });
    const xTicks: { pos: number; text: string }[] = [];
    let last = '';
    combined.months.forEach((ym, k) => { const y = ym.slice(0, 4); if (y !== last) { xTicks.push({ pos: k + 1, text: y }); last = y; } });
    return { lines, xTicks };
  }, [combined, series]);

  if (loading && !series) return <div className="qc-panel"><div className="qc-state">Загрузка месячных рядов…</div></div>;

  const selectedCount = usable.filter(a => include[a.id]).length;

  return (
    <>
      <div className="qc-method">
        <h4>Объединённый портфель</h4>
        <ul>
          <li>«Что будет, если запускать выбранные стратегии вместе» — помесячный ребаланс по заданным весам.</li>
          <li>Период = пересечение месяцев, где у всех выбранных стратегий есть данные. Просадка считается по месячной кривой (грубее дневной).</li>
        </ul>
      </div>

      {usable.length === 0 ? (
        <div className="qc-panel"><div className="qc-state">
          Нет стратегий с месячными данными. {error ? '' : 'Добавьте стратегии и пересчитайте на вкладке «Сравнение».'}
          {error && <div className="qc-err" style={{ marginTop: 8 }}>{error}</div>}
        </div></div>
      ) : (
        <>
          {/* выбор стратегий и весов */}
          <div className="qc-panel">
            <div className="qc-panel-h">
              Состав портфеля <span className="c">выбрано {selectedCount}</span>
              <span className="qc-spacer" />
              <button className="qc-btn" onClick={() => setWeights(prev => { const n = { ...prev }; for (const a of usable) n[a.id] = 1; return n; })}>Равные веса</button>
              <button className="qc-btn" onClick={() => load(true)} disabled={loading} title="Пересчитать, минуя кэш">Пересчитать</button>
            </div>
            <div className="qc-weights">
              {(series?.algos || []).map(a => {
                const ok = !a.error && a.monthly.length >= 2;
                const w = weights[a.id] ?? 1;
                const normPct = ok && include[a.id] ? (w / includedW) * 100 : 0;
                return (
                  <div key={a.id} className={'qc-wrow' + (ok ? '' : ' off')}>
                    <label className="qc-toggle">
                      <input type="checkbox" disabled={!ok} checked={!!include[a.id] && ok}
                        onChange={e => setInclude(prev => ({ ...prev, [a.id]: e.target.checked }))} />
                      <span className="qc-wname">{a.name}</span>
                    </label>
                    <span className={'qc-badge ' + a.status}>{QC_STATUS_LABEL[a.status]}</span>
                    {ok ? (
                      <>
                        <input className="qc-winput" type="number" min={0} step={0.5} value={w}
                          disabled={!include[a.id]}
                          onChange={e => setWeights(prev => ({ ...prev, [a.id]: Math.max(0, parseFloat(e.target.value) || 0) }))} />
                        <span className="qc-wnorm">{include[a.id] ? normPct.toFixed(0) + '%' : '—'}</span>
                      </>
                    ) : (
                      <span className="qc-err" style={{ fontSize: 11 }}>{a.error || 'нет данных'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {!combined || !combined.months.length ? (
            <div className="qc-panel"><div className="qc-state">
              {selectedCount === 0 ? 'Выберите хотя бы одну стратегию.' : 'Нет пересекающегося периода у выбранных стратегий.'}
            </div></div>
          ) : (
            <>
              {/* стат-карточки */}
              <div className="qc-cards">
                <Card k="Период" v={`${combined.years.toFixed(1)} лет`} sub={`${combined.months[0]} … ${combined.months[combined.months.length - 1]}`} />
                <Card k="CAGR" v={fmtPct(combined.cagr)} cls={cls(combined.cagr)} sub={combined.bench ? `БМ ${fmtPct(combined.bench.cagr)}` : undefined} />
                <Card k="Итоговая доходность" v={fmtPct(combined.total)} cls={cls(combined.total)} sub={combined.bench ? `БМ ${fmtPct(combined.bench.total)}` : undefined} />
                <Card k="Макс. просадка" v={fmtPct(combined.maxDD)} cls={cls(combined.maxDD)} sub={combined.bench ? `БМ ${fmtPct(combined.bench.maxDD)}` : undefined} />
                <Card k="σ доходности / год" v={combined.stdYear != null ? '±' + (combined.stdYear * 100).toFixed(1) + '%' : '—'} />
                {combined.bench && <Card k="CAGR vs бенчмарк" v={fmtPct((combined.cagr ?? 0) - (combined.bench.cagr ?? 0))} cls={cls((combined.cagr ?? 0) - (combined.bench.cagr ?? 0))} sub="α в год" />}
              </div>

              {/* график */}
              {chart && (
                <div className="qc-panel">
                  <div className="qc-panel-h">Кривая капитала <span className="c">лог-шкала, старт ×1</span>
                    <span className="qc-spacer" />
                    <span className="qc-legend"><span className="ln" style={{ background: ACC }} />Портфель</span>
                    {combined.benchEquity && <span className="qc-legend"><span className="ln" style={{ background: MUT }} />{series?.benchmark?.name}</span>}
                  </div>
                  <EquityChart lines={chart.lines} xTicks={chart.xTicks} height={300} />
                </div>
              )}

              {/* годовая разбивка */}
              <YearTable yearly={combined.yearly} benchYearly={combined.benchYearly} />
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

function YearTable({ yearly, benchYearly }: { yearly: YearMetric[]; benchYearly: YearMetric[] | null }) {
  const cy = new Map(yearly.map(y => [y.year, y]));
  const by = new Map((benchYearly || []).map(y => [y.year, y]));
  const years = [...new Set([...cy.keys(), ...by.keys()])].sort((a, b) => a - b);
  if (!years.length) return null;
  const retCls = (m?: YearMetric, b?: YearMetric) => {
    if (m && b && m.ret != null && b.ret != null) return m.ret > b.ret ? 'qc-beat' : m.ret < b.ret ? 'qc-lag' : cls(m.ret);
    return m ? cls(m.ret) : 'qc-mut';
  };
  return (
    <div className="qc-tblwrap">
      <table className="qc-matrix">
        <thead>
          <tr className="groups">
            <th className="yr" rowSpan={2}>Год</th>
            <th className="grp" colSpan={3}>Портфель</th>
            {benchYearly && <th className="grp bench" colSpan={3}>Бенчмарк</th>}
          </tr>
          <tr>
            <th className="grp">Просадка</th><th>Доходн.</th><th>Накопит.</th>
            {benchYearly && <><th className="grp">Просадка</th><th>Доходн.</th><th>Накопит.</th></>}
          </tr>
        </thead>
        <tbody>
          {years.map(y => {
            const m = cy.get(y), b = by.get(y);
            return (
              <tr key={y}>
                <td className="yr">{y}</td>
                <td className={'grp ' + (m ? cls(m.maxDD) : 'qc-mut')}>{m ? fmtPct(m.maxDD) : '—'}</td>
                <td className={retCls(m, b)}>{m ? fmtPct(m.ret) : '—'}</td>
                <td className={m ? cls(m.cumulative) : 'qc-mut'}>{m ? fmtPct(m.cumulative) : '—'}</td>
                {benchYearly && <>
                  <td className={'grp ' + (b ? cls(b.maxDD) : 'qc-mut')}>{b ? fmtPct(b.maxDD) : '—'}</td>
                  <td className={b ? cls(b.ret) : 'qc-mut'}>{b ? fmtPct(b.ret) : '—'}</td>
                  <td className={b ? cls(b.cumulative) : 'qc-mut'}>{b ? fmtPct(b.cumulative) : '—'}</td>
                </>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
