'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useInvestorDetail } from '../../_components/useDetail';
import LineChart, { type ChartSeries } from '../../_components/LineChart';
import { runBacktest } from '@/lib/superinvestor/compute';
import { investorBySlug } from '@/lib/superinvestor/registry';
import { PERIODS, type PeriodKey } from '@/lib/superinvestor/periods';
import { pctP, pctFu, fixed } from '@/lib/superinvestor/format';
import type { BacktestConfig } from '@/lib/superinvestor/types';

const DELAYS = [0, 1, 5, 10];
const COLORS = ['#cfc8fb', '#7c6cf0', '#f5b53d', '#f4626a'];

export default function BacktestPage() {
  const params = useParams();
  const slug = String(params.slug || '');
  const inv = investorBySlug(slug);
  const [period, setPeriod] = useState<PeriodKey>('5');
  const { data, loading, error } = useInvestorDetail(slug, period, true); // full=1 → priceMatrix
  const meta = data?.investor || inv;
  const [minWeightPct, setMinWeightPct] = useState(0);

  const results = useMemo(() => {
    if (!data || !data.priceMatrix.dates.length) return null;
    const configs: BacktestConfig[] = DELAYS.map(d => ({ delayDays: d, minWeight: minWeightPct / 100 }));
    return runBacktest(data.quarters, data.priceMatrix, configs);
  }, [data, minWeightPct]);

  // Оверлей кривых на общей оси дат (берём ось T+0 — самый ранний старт).
  const chart = useMemo(() => {
    if (!results || !results.length) return null;
    const ref = results[0].curve;
    const axis = ref.dates;
    const series: ChartSeries[] = results.map((r, i) => {
      const map = new Map<string, number>();
      r.curve.dates.forEach((d, j) => map.set(d, r.curve.copy[j]));
      return {
        label: `T+${r.config.delayDays}`,
        color: COLORS[i],
        values: axis.map(d => (map.has(d) ? map.get(d)! : NaN)),
      };
    });
    series.push({ label: 'SPY', color: '#9aa0ad', values: ref.spy, dash: true });
    return { axis, series, markers: ref.rebalanceDates };
  }, [results]);

  const insight = useMemo(() => {
    if (!results || results.length < 2) return null;
    const a0 = results[0].finalAlphaPct;
    const aN = results[results.length - 1].finalAlphaPct;
    return { a0, aN, drop: a0 - aN, delay: results[results.length - 1].config.delayDays };
  }, [results]);

  return (
    <main>
      <div className="si-top">
        <div className="si-title">Бэктест copy-стратегии · {meta?.name}</div>
        <div className="si-sub">Как меняется alpha, если копировать филинг не мгновенно, а с задержкой входа.</div>
      </div>

      <div className="si-method">
        <h4>Что сравниваем</h4>
        <ul>
          <li><b>T+0</b> — покупаем в день подачи 13F. <b>T+1/T+5/T+10</b> — с задержкой N торговых дней (рынок уже отыграл часть филинга).</li>
          <li><b>Мин. вес позиции</b> отбрасывает мелкие «хвостовые» позиции и ренормирует портфель на крупные ставки.</li>
          <li>Все кривые нормированы к старту = 1; сравнение с SPY за то же окно.</li>
        </ul>
      </div>

      <div className="si-bar">
        <span className="lbl">Период</span>
        <div className="si-seg">{PERIODS.map(p => <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}</div>
      </div>

      {error ? (
        <div className="si-panel"><div className="si-state si-err">Ошибка: {error}</div></div>
      ) : loading && !data ? (
        <div className="si-panel"><div className="si-state">Загрузка данных бэктеста…</div></div>
      ) : !results || !chart ? (
        <div className="si-panel"><div className="si-state">Недостаточно данных для бэктеста.</div></div>
      ) : (
        <>
          <div className="si-controls">
            <div className="si-ctl">
              <label>Мин. вес позиции: <span className="val">{minWeightPct.toFixed(1)}%</span></label>
              <input className="si-range" type="range" min={0} max={10} step={0.5}
                value={minWeightPct} onChange={e => setMinWeightPct(parseFloat(e.target.value))} />
            </div>
            <div className="si-ctl" style={{ alignSelf: 'end' }}>
              <label>Задержки входа</label>
              <div className="si-legend" style={{ marginTop: 0 }}>
                {DELAYS.map((d, i) => (
                  <span key={d}><span className="ln" style={{ background: COLORS[i] }} />T+{d}</span>
                ))}
                <span><span className="ln" style={{ background: '#9aa0ad' }} />SPY</span>
              </div>
            </div>
          </div>

          <div className="si-panel">
            <div className="si-panel-h">Equity curve по задержкам входа <span className="c">старт = 1.0</span></div>
            <LineChart dates={chart.axis} series={chart.series} markers={chart.markers}
              height={360} refLine={1} yFormat={v => '×' + v.toFixed(2)} />
          </div>

          <div className="si-tblwrap">
            <table className="si-tbl">
              <thead>
                <tr>
                  <th className="l">конфигурация</th>
                  <th>copy ret</th>
                  <th>alpha vs SPY</th>
                  <th>sharpe</th>
                  <th>max DD</th>
                  <th>vs T+0</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.config.delayDays}>
                    <td className="l"><span className="si-sym" style={{ color: COLORS[i] }}>T+{r.config.delayDays}</span> <span className="si-mut">/ мин. вес {pctFu(r.config.minWeight, 1)}</span></td>
                    <td className={r.finalCopyPct >= 0 ? 'si-pos' : 'si-neg'}>{pctP(r.finalCopyPct)}</td>
                    <td className={r.finalAlphaPct >= 0 ? 'si-pos' : 'si-neg'}>{pctP(r.finalAlphaPct)}</td>
                    <td>{fixed(r.sharpe, 2)}</td>
                    <td className="si-neg">{pctP(r.maxDrawdownPct)}</td>
                    <td className="si-mut">{i === 0 ? '—' : pctP(r.finalAlphaPct - results[0].finalAlphaPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {insight && (
            <div className="si-insight">
              <h4>Ключевой инсайт</h4>
              {insight.drop > 0 ? (
                <>Альфа проседает с задержкой входа: <b>T+0 даёт {pctP(insight.a0)}</b>, а T+{insight.delay} — лишь {pctP(insight.aN)}.
                Промедление в {insight.delay} дн. стоит <b>{pctP(insight.drop)}</b> альфы — конкретный аргумент в пользу мгновенной реакции на филинг.</>
              ) : (
                <>На этом окне задержка входа не разрушает альфу (T+0 {pctP(insight.a0)} vs T+{insight.delay} {pctP(insight.aN)}).
                Поведение зависит от стиля инвестора и периода — поменяйте окно/мин. вес и сравните.</>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
