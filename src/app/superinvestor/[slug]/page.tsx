'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useInvestorDetail } from '../_components/useDetail';
import LineChart from '../_components/LineChart';
import InvestorAI from '../_components/InvestorAI';
import { investorBySlug } from '@/lib/superinvestor/registry';
import { INVESTOR_TYPE_LABEL } from '@/lib/superinvestor/types';
import { PERIODS, type PeriodKey } from '@/lib/superinvestor/periods';
import { pctP, pctFu, pctF, money, fixed } from '@/lib/superinvestor/format';

export default function InvestorCardPage() {
  const params = useParams();
  const slug = String(params.slug || '');
  const inv = investorBySlug(slug);
  const [period, setPeriod] = useState<PeriodKey>('3');
  const { data, loading, error } = useInvestorDetail(slug, period, false);
  const meta = data?.investor || inv;

  const k = data?.kpis;
  const curve = data?.equityCurve;

  return (
    <main>
      <div className="si-invhead">
        <div>
          <div className="nm">
            {meta?.name || slug}{' '}
            {meta && <span className={`si-badge ${meta.type}`}>{INVESTOR_TYPE_LABEL[meta.type]}</span>}
          </div>
          <div className="fund">{meta?.fund} · CIK {meta?.cik}</div>
          {meta?.blurb && <div className="blurb">{meta.blurb}</div>}
        </div>
        <div className="si-aum">
          <div className="k">AUM (13F, последний квартал)</div>
          <div className="v">{data ? money(data.aum) : '—'}</div>
          <div className="si-seg" style={{ marginTop: 8 }}>
            {PERIODS.map(p => (
              <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="si-overview">
        <aside className="si-ov-left"><InvestorAI slug={slug} /></aside>
        <div className="si-ov-right">
      {error ? (
        <div className="si-panel"><div className="si-state si-err">Ошибка: {error}
          {/(ключ|key|403|401|402|forbidden|payment|institutional|api)/i.test(error) && (
            <><br /><span className="si-mut">Нужен FMP-ключ с доступом к Form 13F (institutional-ownership).</span></>
          )}
        </div></div>
      ) : loading && !data ? (
        <div className="si-panel"><div className="si-state">Загрузка copy-стратегии…</div></div>
      ) : !data ? null : (
        <>
          <div className="hm-kpis">
            <div className="hm-kpi">
              <div className="k">copy α vs SPY</div>
              <div className="v" style={{ color: k!.alphaPct >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>{pctP(k!.alphaPct)}</div>
              <div className="vsub">{pctP(k!.alphaAnnPct)} / год</div>
            </div>
            <div className="hm-kpi">
              <div className="k">Win rate</div>
              <div className="v">{pctFu(k!.winRatePct / 100)}</div>
              <div className="vsub">{k!.closedTrades} закрытых · {k!.openPositions} открытых</div>
            </div>
            <div className="hm-kpi">
              <div className="k">Sharpe (copy)</div>
              <div className="v">{fixed(k!.sharpe, 2)}</div>
              <div className="vsub">годовой, по месяцам</div>
            </div>
            <div className="hm-kpi">
              <div className="k">Max drawdown</div>
              <div className="v" style={{ color: 'var(--hm-neg)' }}>{pctP(k!.maxDrawdownPct)}</div>
              <div className="vsub">copy-кривая</div>
            </div>
            <div className="hm-kpi">
              <div className="k">copy / SPY доходность</div>
              <div className="v" style={{ fontSize: 16 }}>
                <span style={{ color: 'var(--hm-acc)' }}>{pctP(k!.copyReturnPct)}</span>
                <span className="si-mut"> / {pctP(k!.spyReturnPct)}</span>
              </div>
              <div className="vsub">за {data.window.from.slice(0, 4)}–{data.window.to.slice(0, 4)}</div>
            </div>
          </div>

          <div className="si-panel">
            <div className="si-panel-h">Equity curve: copy-стратегия vs SPY <span className="c">старт = 1.0 · маркеры = даты подачи 13F</span></div>
            {curve && curve.dates.length > 1 ? (
              <>
                <LineChart
                  dates={curve.dates}
                  height={340}
                  refLine={1}
                  markers={curve.rebalanceDates}
                  yFormat={v => '×' + v.toFixed(2)}
                  series={[
                    { label: 'copy', color: '#7c6cf0', values: curve.copy },
                    { label: 'SPY', color: '#9aa0ad', values: curve.spy, dash: true },
                  ]}
                />
                <div className="si-legend">
                  <span><span className="ln" style={{ background: '#7c6cf0' }} />copy-стратегия</span>
                  <span><span className="ln" style={{ background: '#9aa0ad' }} />SPY</span>
                  <span><span className="mk" style={{ background: '#7c6cf0', opacity: .4 }} />подача 13F</span>
                </div>
              </>
            ) : <div className="si-state">Недостаточно данных за период.</div>}
          </div>

          <div className="si-panel">
            <div className="si-panel-h">Открытые позиции <span className="c">{data.openPositions.length} шт · нереализованный P&L по копированию филингов</span></div>
            <div className="si-tblwrap" style={{ border: 0 }}>
              <table className="si-tbl">
                <thead>
                  <tr>
                    <th className="l">тикер</th>
                    <th className="l">компания</th>
                    <th>вес</th>
                    <th>стоимость</th>
                    <th>ср. вход</th>
                    <th>тек. цена</th>
                    <th>unreal. P&L</th>
                    <th>кварталов</th>
                    <th className="l">с</th>
                  </tr>
                </thead>
                <tbody>
                  {data.openPositions.map(p => (
                    <tr key={p.symbol}>
                      <td className="l si-sym">{p.symbol}</td>
                      <td className="l si-nm">{p.name || '—'}</td>
                      <td>{pctFu(p.weight)}</td>
                      <td className="si-mut">{money(p.value)}</td>
                      <td className="si-mut">{fixed(p.avgCost)}</td>
                      <td>{fixed(p.lastPrice)}</td>
                      <td className={p.unrealizedPct >= 0 ? 'si-pos' : 'si-neg'}>{pctF(p.unrealizedPct)}</td>
                      <td className="si-mut">{p.quartersHeld}</td>
                      <td className="l si-mut">{p.firstSeen}</td>
                    </tr>
                  ))}
                  {!data.openPositions.length && <tr><td colSpan={9} className="l si-state">Нет открытых позиций.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
        </div>
      </div>
    </main>
  );
}
