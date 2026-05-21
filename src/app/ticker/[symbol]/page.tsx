'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTicker } from '../_components/useTicker';
import PriceChart, { type Marker } from '../_components/PriceChart';
import TickerAI from '../_components/TickerAI';
import TickerSearch from '../_components/TickerSearch';
import { RANGES, BENCHMARKS, type RangeKey } from '@/lib/ticker/types';
import { pctP, money, fixed, num } from '@/lib/superinvestor/format';

type ChartMode = 'pct' | 'log';
type EvTab = 'earnings' | 'dividends' | 'macro';

const EARN_COLOR = '#f5b53d';
const DIV_COLOR = '#34d399';

export default function TickerPage() {
  const params = useParams();
  const symbol = String(params.symbol || '').toUpperCase();

  const [benchmark, setBenchmark] = useState('SPY');
  const [range, setRange] = useState<RangeKey>('2010');
  const [mode, setMode] = useState<ChartMode>('pct');
  const [cats, setCats] = useState({ earnings: true, dividends: false, macro: true });
  const [evTab, setEvTab] = useState<EvTab>('earnings');

  const { data, loading, error } = useTicker(symbol, benchmark, range);
  const p = data?.profile;
  const k = data?.kpis;

  const benchLabel = BENCHMARKS.find(b => b.symbol === benchmark)?.symbol || benchmark;

  const markers: Marker[] = useMemo(() => {
    if (!data) return [];
    const out: Marker[] = [];
    if (cats.earnings) for (const e of data.events.earnings) {
      out.push({ date: e.date, color: EARN_COLOR, cat: 'earnings',
        label: `Отчётность${e.surprisePct != null ? ` · EPS-сюрприз ${pctP(e.surprisePct)}` : ''}` });
    }
    if (cats.dividends) for (const d of data.events.dividends) {
      out.push({ date: d.date, color: DIV_COLOR, cat: 'dividends', label: `Дивиденд $${d.amount.toFixed(2)}` });
    }
    if (cats.macro) for (const m of data.events.market) {
      out.push({ date: m.date, color: m.color, cat: 'macro', label: m.title });
    }
    return out;
  }, [data, cats]);

  const chgPos = (p?.changePct ?? 0) >= 0;

  return (
    <main>
      <div style={{ marginBottom: 14 }}>
        <TickerSearch placeholder="Перейти к другому тикеру…" />
      </div>

      <div className="tk-head">
        <div className="tk-head-l">
          <div className="tk-id">
            <span className="tk-logo-ph">{symbol.slice(0, 2)}</span>
            <div>
              <div className="tk-sym">{symbol}</div>
              <div className="tk-name">{p?.name || (loading ? 'Загрузка…' : symbol)}</div>
            </div>
          </div>
          <div className="tk-badges">
            {p?.sector && <span className="si-badge">{p.sector}</span>}
            {p?.industry && <span className="si-badge">{p.industry}</span>}
            {p?.exchange && <span className="si-badge">{p.exchange}</span>}
            {p?.isEtf && <span className="si-badge concentrated">ETF</span>}
          </div>
        </div>

        <div className="tk-quote">
          <div className="tk-price">{p?.price != null ? fixed(p.price) : '—'}</div>
          <div className="tk-chg" style={{ color: chgPos ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
            {p?.change != null ? `${chgPos ? '+' : ''}${fixed(p.change)}` : '—'} ({pctP(p?.changePct)})
          </div>
          <div className="tk-quote-sub">
            {p?.marketCap != null && <>Mkt cap {money(p.marketCap)} · </>}
            {p?.range52 && <>52н {p.range52}</>}
          </div>
        </div>
      </div>

      {p && (
        <div className="tk-facts">
          {p.country && <div className="tk-fact"><span className="k">Страна</span><span className="v">{p.country}</span></div>}
          {p.employees != null && <div className="tk-fact"><span className="k">Сотрудников</span><span className="v">{num(p.employees)}</span></div>}
          {p.beta != null && <div className="tk-fact"><span className="k">Beta</span><span className="v">{fixed(p.beta)}</span></div>}
          {p.ceo && <div className="tk-fact"><span className="k">CEO</span><span className="v">{p.ceo}</span></div>}
          {p.ipoDate && <div className="tk-fact"><span className="k">IPO</span><span className="v">{p.ipoDate}</span></div>}
          {p.website && <div className="tk-fact"><span className="k">Сайт</span><a href={p.website} target="_blank" rel="noreferrer">{p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></div>}
        </div>
      )}

      <div className="si-overview" style={{ marginTop: 16 }}>
        <div className="si-ov-main">
          {error ? (
            <div className="si-panel"><div className="si-state si-err">Ошибка: {error}
              {/(ключ|key|403|401|402|forbidden|payment|api)/i.test(error) && (
                <><br /><span className="si-mut">Нужен FMP-ключ с доступом к историческим ценам и профилю.</span></>
              )}
            </div></div>
          ) : loading && !data ? (
            <div className="si-panel"><div className="si-state">Загрузка данных тикера…</div></div>
          ) : !data || !k ? null : (
            <>
              <div className="hm-kpis">
                <div className="hm-kpi">
                  <div className="k">Доходность · {range.toUpperCase()}</div>
                  <div className="v" style={{ color: k.totalReturnPct >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>{pctP(k.totalReturnPct)}</div>
                  <div className="vsub">{benchLabel} {pctP(k.benchReturnPct)}</div>
                </div>
                <div className="hm-kpi">
                  <div className="k">α к {benchLabel}</div>
                  <div className="v" style={{ color: k.alphaPct >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>{pctP(k.alphaPct)}</div>
                  <div className="vsub">избыточная доходность</div>
                </div>
                <div className="hm-kpi">
                  <div className="k">CAGR</div>
                  <div className="v">{pctP(k.cagrPct)}</div>
                  <div className="vsub">{benchLabel} {pctP(k.benchCagrPct)}</div>
                </div>
                <div className="hm-kpi">
                  <div className="k">Max drawdown</div>
                  <div className="v" style={{ color: 'var(--hm-neg)' }}>{pctP(k.maxDrawdownPct)}</div>
                  <div className="vsub">в окне</div>
                </div>
                <div className="hm-kpi">
                  <div className="k">Волатильность</div>
                  <div className="v">{k.volPct.toFixed(1)}%</div>
                  <div className="vsub">годовая</div>
                </div>
              </div>

              <div className="si-panel">
                <div className="si-panel-h">
                  Доходность vs {benchLabel}
                  <span className="c">старт окна = 0% · {data.window.from} → {data.window.to}</span>
                </div>

                <div className="tk-ctlbar">
                  <div className="tk-ctl-grp">
                    <span className="tk-ctl-lbl">Бенчмарк</span>
                    <select className="tk-select" value={benchmark} onChange={e => setBenchmark(e.target.value)}>
                      {BENCHMARKS.map(b => <option key={b.symbol} value={b.symbol}>{b.symbol} — {b.label}</option>)}
                    </select>
                  </div>
                  <div className="si-seg">
                    {RANGES.map(r => (
                      <button key={r.key} className={range === r.key ? 'on' : ''} onClick={() => setRange(r.key)}>{r.label}</button>
                    ))}
                  </div>
                  <div className="hm-spacer" />
                  <div className="si-seg">
                    <button className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')}>Доходность %</button>
                    <button className={mode === 'log' ? 'on' : ''} onClick={() => setMode('log')}>Рост $1 (лог)</button>
                  </div>
                </div>

                {data.chart.dates.length > 1 ? (
                  <>
                    <PriceChart
                      dates={data.chart.dates}
                      height={360}
                      log={mode === 'log'}
                      refLine={mode === 'pct' ? 0 : undefined}
                      yFormat={mode === 'pct' ? v => pctP(v, 0) : v => '×' + v.toFixed(2)}
                      markers={markers}
                      series={[
                        { label: symbol, color: '#7c6cf0', values: mode === 'pct' ? data.chart.symbolPct : data.chart.symbolGrowth },
                        { label: benchLabel, color: '#9aa0ad', dash: true, values: mode === 'pct' ? data.chart.benchmarkPct : data.chart.benchmarkGrowth },
                      ]}
                    />
                    <div className="si-legend">
                      <span><span className="ln" style={{ background: '#7c6cf0' }} />{symbol}</span>
                      <span><span className="ln" style={{ background: '#9aa0ad' }} />{benchLabel}</span>
                    </div>
                    <div className="tk-mklegend">
                      <span className={`tk-mkchip ${cats.earnings ? 'on' : 'off'}`} onClick={() => setCats(c => ({ ...c, earnings: !c.earnings }))}>
                        <span className="dot" style={{ background: EARN_COLOR }} />Отчётности
                      </span>
                      <span className={`tk-mkchip ${cats.dividends ? 'on' : 'off'}`} onClick={() => setCats(c => ({ ...c, dividends: !c.dividends }))}>
                        <span className="dot" style={{ background: DIV_COLOR }} />Дивиденды
                      </span>
                      <span className={`tk-mkchip ${cats.macro ? 'on' : 'off'}`} onClick={() => setCats(c => ({ ...c, macro: !c.macro }))}>
                        <span className="dot" style={{ background: '#db2777' }} />Макро-события
                      </span>
                    </div>
                  </>
                ) : <div className="si-state">Недостаточно данных за период.</div>}
              </div>

              <div className="si-panel">
                <div className="si-panel-h">События</div>
                <div className="tk-evtabs">
                  <button className={`tk-evtab ${evTab === 'earnings' ? 'on' : ''}`} onClick={() => setEvTab('earnings')}>
                    Отчётности<span className="n">{data.events.earnings.length}</span>
                  </button>
                  <button className={`tk-evtab ${evTab === 'dividends' ? 'on' : ''}`} onClick={() => setEvTab('dividends')}>
                    Дивиденды<span className="n">{data.events.dividends.length}</span>
                  </button>
                  <button className={`tk-evtab ${evTab === 'macro' ? 'on' : ''}`} onClick={() => setEvTab('macro')}>
                    Макро<span className="n">{data.events.market.length}</span>
                  </button>
                </div>

                {evTab === 'earnings' && (
                  <div className="tk-evlist">
                    {data.events.earnings.map((e, i) => (
                      <div key={i} className="tk-evrow">
                        <span className="dt">{e.date}</span>
                        <span className="ti">
                          EPS {e.epsActual != null ? fixed(e.epsActual) : '—'}
                          <span className="si-mut"> / прогноз {e.epsEst != null ? fixed(e.epsEst) : '—'}</span>
                          {e.surprisePct != null && (
                            <span className={e.surprisePct >= 0 ? 'si-pos' : 'si-neg'}> · {pctP(e.surprisePct)}</span>
                          )}
                        </span>
                        <span className="meta">{e.revActual != null ? money(e.revActual) : ''}</span>
                      </div>
                    ))}
                    {!data.events.earnings.length && <div className="si-state">Нет данных по отчётностям в окне.</div>}
                  </div>
                )}

                {evTab === 'dividends' && (
                  <div className="tk-evlist">
                    {data.events.dividends.map((d, i) => (
                      <div key={i} className="tk-evrow">
                        <span className="dt">{d.date}</span>
                        <span className="ti">Дивиденд ${d.amount.toFixed(2)}</span>
                        <span className="meta">{d.yield != null ? `${d.yield.toFixed(2)}%` : ''}</span>
                      </div>
                    ))}
                    {!data.events.dividends.length && <div className="si-state">Дивиденды в окне не выплачивались.</div>}
                  </div>
                )}

                {evTab === 'macro' && (
                  <div className="tk-evlist">
                    {data.events.market.map((m, i) => (
                      <div key={i} className="tk-evrow">
                        <span className="dot" style={{ background: m.color }} />
                        <span className="dt">{m.date}</span>
                        <span className="ti">{m.title}</span>
                      </div>
                    ))}
                    {!data.events.market.length && <div className="si-state">Нет отмеченных макро-событий в окне.</div>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <aside className="si-ov-ai"><TickerAI symbol={symbol} name={p?.name} /></aside>
      </div>
    </main>
  );
}
