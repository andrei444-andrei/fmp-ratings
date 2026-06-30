'use client';

// Раздел «Анализ тикера»: историческое распределение исходов по СОСТОЯНИЯМ одного тикера для генерации
// гипотез. Сервер (/api/ticker/panel) отдаёт ряд + факторы + форвард-доходности ОДИН раз; бины, условия и
// статистика (baseline+edge, n_eff, CI, эпохи) считаются мгновенно на клиенте через @/lib/ticker/engine.

import { useEffect, useMemo, useRef, useState } from 'react';
import './ticker.css';
import {
  binStats, baselineStats, percentileOf, lastNonNull,
  type BinCfg, type BinResult, type Bin, type BinUnit,
} from '@/lib/ticker/engine';
import type { TickerPanel } from '@/lib/ticker/panel';

const pct = (x: number, d = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
const pctRaw = (x: number, d = 1) => (x * 100).toFixed(d) + '%';
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

type Widget = { id: string; key: string; unit: BinUnit; title: string; desc: string; def: BinCfg };
const WIDGETS: Widget[] = [
  { id: 'ath', key: 'distAth', unit: 'signed', title: 'Расстояние от ATH → доходность',
    desc: 'Где цена относительно исторического максимума. Хвостовые бины (глубокие просадки) редки → малый n.',
    def: { mode: 'manual', k: 5, minN: 25, manual: [-0.20, -0.10, -0.05, -0.02] } },
  { id: 'sma200', key: 'smaDist200', unit: 'signed', title: 'Отклонение от SMA200 → доходность',
    desc: 'Под/над SMA200 (тренд). «Над SMA200 → +» почти тавтология для бычьего тренда — смотри EDGE, не raw.',
    def: { mode: 'auto', k: 5, minN: 120, manual: [-0.10, -0.03, 0.03, 0.10] } },
  { id: 'vol', key: 'vol21', unit: 'pos', title: 'Волатильность 21д → доходность',
    desc: 'Реализованная вола (annualized). Вола кластеризуется → соседние наблюдения не независимы (CI учитывает это через n_eff).',
    def: { mode: 'auto', k: 5, minN: 120, manual: [0.12, 0.18, 0.25, 0.35] } },
  { id: 'dd21', key: 'dd21', unit: 'signed', title: 'Просадка за 21д → доходность',
    desc: 'Текущая просадка от макс. за окно 21д (фактор на входе). Тест на mean-reversion. Глубокие просадки редки → малый n.',
    def: { mode: 'manual', k: 4, minN: 25, manual: [-0.15, -0.08, -0.03] } },
  { id: 'rs', key: 'rs63', unit: 'signed', title: 'Относит. сила vs SPY (63д) → доходность',
    desc: 'Накопленный обгон бенчмарка за 63д. Сырой обгон ≈ бета×рынок; для чистого свойства тикера нужна β-альфа (в реальной версии outcome=alpha).',
    def: { mode: 'auto', k: 5, minN: 120, manual: [-0.10, -0.03, 0.03, 0.10] } },
];
const POPULAR = ['NVDA', 'AAPL', 'KO', 'XLE', 'SPY'];
const HZ = [5, 10, 21, 63];
const RANGES: { label: string; days: number }[] = [
  { label: '1Г', days: 252 }, { label: '3Г', days: 756 }, { label: '5Л', days: 1260 },
  { label: '10Л', days: 2520 }, { label: 'Всё', days: 0 },
];

export default function TickerPage() {
  const [ticker, setTicker] = useState('AAPL');
  const [H, setH] = useState(21);
  const [mode, setMode] = useState<'edge' | 'raw'>('edge');
  const [outcome, setOutcome] = useState<'ret' | 'exc'>('ret');
  const [sel, setSel] = useState<Record<string, number | undefined>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [openCfg, setOpenCfg] = useState<Record<string, boolean>>({});
  const [binCfg, setBinCfg] = useState<Record<string, BinCfg>>(() => {
    const o: Record<string, BinCfg> = {};
    WIDGETS.forEach((w) => (o[w.id] = JSON.parse(JSON.stringify(w.def))));
    return o;
  });
  const [corrAssets, setCorrAssets] = useState<string[]>(['SPY', 'QQQ', 'GLD', 'TLT']);
  const [recent, setRecent] = useState<string[]>(['AAPL', 'NVDA', 'KO']);
  const [sma50On, setSma50On] = useState(true);
  const [sma200On, setSma200On] = useState(true);
  const [ddOn, setDdOn] = useState(false);
  const [logOn, setLogOn] = useState(true);
  const [chartRange, setChartRange] = useState(0); // торг. дней; 0 = вся история

  const [panel, setPanel] = useState<TickerPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [corrSeries, setCorrSeries] = useState<Record<string, [string, number][]>>({});

  const [query, setQuery] = useState('');
  const [dropOpen, setDropOpen] = useState(false);
  const [dropAct, setDropAct] = useState(-1);

  const tipRef = useRef<HTMLDivElement | null>(null);
  const hlRef = useRef<SVGLineElement | null>(null);

  /* ---------- data fetch ---------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/ticker/panel?symbol=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((p) => { if (alive) { setPanel(p && Array.isArray(p.dates) && p.dates.length ? p : null); setLoading(false); } })
      .catch(() => { if (alive) { setPanel(null); setLoading(false); } });
    return () => { alive = false; };
  }, [ticker]);

  useEffect(() => {
    const syms = corrAssets.join(',');
    if (!syms) { setCorrSeries({}); return; }
    let alive = true;
    fetch(`/api/ticker/series?symbols=${encodeURIComponent(syms)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setCorrSeries(j.series || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [corrAssets]);

  function goTicker(sym: string) {
    const s = (sym || '').trim().toUpperCase();
    if (!s) return;
    setTicker(s);
    setRecent((r) => [s, ...r.filter((x) => x !== s)].slice(0, 6));
    setSel({}); setQuery(''); setDropOpen(false);
  }
  function updateCfg(id: string, fn: (c: BinCfg) => void) {
    setBinCfg((prev) => { const c: BinCfg = JSON.parse(JSON.stringify(prev[id])); fn(c); return { ...prev, [id]: c }; });
  }

  /* ---------- derived ---------- */
  const years = useMemo(() => (panel ? panel.dates.map((d) => +d.slice(0, 4)) : []), [panel]);
  // выбранный исход: сырая доходность или превышение бенчмарка за то же окно
  const fwAll = panel ? (outcome === 'exc' ? panel.forwardsExc : panel.forwards) : null;
  const outLabel = outcome === 'exc' ? 'превышение SPY' : 'доходность';
  const baseline = useMemo(() => (fwAll ? baselineStats(fwAll[String(H)] || []) : null), [fwAll, H]);
  const cfgKey = JSON.stringify(binCfg);
  const results = useMemo(() => {
    const m: Record<string, BinResult> = {};
    if (!panel || !baseline || !fwAll) return m;
    const fwd = fwAll[String(H)] || [];
    WIDGETS.forEach((w) => {
      m[w.id] = binStats(panel.factors[w.key] || [], fwd, years, binCfg[w.id], w.unit, baseline.mean, H);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, H, outcome, cfgKey, years, baseline]);

  /* ---------- search dropdown ---------- */
  const dropItems = useMemo(() => {
    const q = query.trim().toUpperCase();
    const pool = [...new Set([...recent, ...POPULAR])];
    const list = pool.filter((s) => !q || s.includes(q)).slice(0, 7).map((s) => ({ sym: s, meta: 'тикер', analyze: false }));
    if (q) list.unshift({ sym: q, meta: pool.includes(q) ? 'анализировать' : 'новый символ', analyze: true });
    return list;
  }, [query, recent]);

  const lastClose = panel ? panel.close[panel.close.length - 1] : null;
  const lastDate = panel ? panel.dates[panel.dates.length - 1] : null;

  /* ---------- render ---------- */
  return (
    <div className="tk">
      <h1>Анализ тикера <span className="badge" style={{ verticalAlign: 'middle' }}>conditional forward-returns</span></h1>
      <div className="sub">Историческое распределение исходов по состояниям одного тикера — для генерации гипотез, а не подтверждённых закономерностей.</div>

      <div className="banner">
        <span>⚠️</span>
        <span><b>Разведка по ОДНОМУ активу.</b> Малые выборки и автокорреляция перекрывающихся окон делают паттерн кандидатом, а не выводом: смотри <b>edge</b> (а не raw), <b>n_eff</b> и доверительный интервал; серое = незначимо. Границы условий настраиваются на каждом виджете (⚙).</span>
      </div>

      {/* текущий тикер */}
      <div className="tk-current">
        <span className="cur-sym">{panel ? panel.symbol : ticker}</span>
        <span className="cur-meta">
          {panel?.meta.company ? <b>{panel.meta.company}</b> : null}
          {panel?.meta.sector ? <> · {panel.meta.sector}</> : null}
          {panel?.meta.currency ? <> · {panel.meta.currency}</> : null}
          {lastClose != null ? <> · посл. {lastClose.toFixed(2)} ({lastDate})</> : null}
          {panel?.synthetic ? <> · <span className="warnish">⚠ синтетика без ключей</span></> : null}
        </span>
      </div>

      {/* controls */}
      <div className="controls">
        <div><span className="lbl">Тикер</span>
          <span className="searchbox">
            <input value={query} placeholder={`${ticker} · впиши любой символ…`} autoComplete="off" spellCheck={false}
              onChange={(e) => { setQuery(e.target.value); setDropOpen(true); setDropAct(-1); }}
              onFocus={() => setDropOpen(true)}
              onBlur={() => setTimeout(() => setDropOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setDropAct((a) => Math.min(dropItems.length - 1, a + 1));
                else if (e.key === 'ArrowUp') setDropAct((a) => Math.max(0, a - 1));
                else if (e.key === 'Enter') goTicker(dropAct >= 0 ? dropItems[dropAct].sym : query);
                else if (e.key === 'Escape') setDropOpen(false);
              }} />
            <div className={`dropdown${dropOpen ? ' open' : ''}`}>
              {dropItems.map((it, i) => (
                <div key={i} className={`drow${it.analyze ? ' analyze' : ''}${i === dropAct ? ' act' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); goTicker(it.sym); }}>
                  <span className="sym">{it.analyze ? '↵ ' + it.sym : it.sym}</span><span className="dmeta">{it.meta}</span>
                </div>
              ))}
            </div>
          </span>
        </div>
        <div><span className="lbl">Быстро</span><span className="seg">
          {POPULAR.map((s) => <button key={s} className={s === ticker ? 'active' : ''} onClick={() => goTicker(s)}>{s}</button>)}
        </span></div>
        <div><span className="lbl">Горизонт</span><span className="seg">
          {HZ.map((h) => <button key={h} className={h === H ? 'active' : ''} onClick={() => setH(h)}>{h}д</button>)}
        </span></div>
        <div><span className="lbl">Исход</span><span className="seg">
          <button className={outcome === 'ret' ? 'active' : ''} onClick={() => setOutcome('ret')}>Доходность</button>
          <button className={outcome === 'exc' ? 'active' : ''} onClick={() => setOutcome('exc')}>vs SPY (excess)</button>
        </span></div>
        <div><span className="lbl">Показ</span><span className="seg">
          <button className={mode === 'edge' ? 'active' : ''} onClick={() => setMode('edge')}>edge (vs baseline)</button>
          <button className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>raw</button>
        </span></div>
      </div>
      <div className="row" style={{ margin: '-6px 0 14px' }}>
        <span className="lbl">Недавние:</span>
        {recent.map((s) => <span key={s} className="chiptog" onClick={() => goTicker(s)}>{s}</span>)}
      </div>

      {loading && <div className="card"><div className="loading">Загрузка панели {ticker}…</div></div>}
      {!loading && !panel && <div className="card"><div className="loading">Не удалось получить данные по {ticker}. Попробуй другой символ.</div></div>}

      {panel && baseline && fwAll && (
        <>
          {/* state now */}
          <div className="card">
            <h2><span className="ht">Состояние сейчас · <b>{panel.symbol}</b></span></h2>
            <p className="desc">Текущие значения факторов и их перцентиль в собственной истории тикера. Ниже подсвечивается, в какой бин попадает каждое значение.</p>
            <div className="grid-state">
              {([
                { k: 'Дист. от ATH', key: 'distAth', f: (v: number) => pctRaw(v, 1) },
                { k: 'vs SMA50', key: 'smaDist50', f: (v: number) => pct(v, 1) },
                { k: 'vs SMA200', key: 'smaDist200', f: (v: number) => pct(v, 1) },
                { k: 'Вола 21д', key: 'vol21', f: (v: number) => pctRaw(v, 0) },
                { k: 'RS vs SPY 63д', key: 'rs63', f: (v: number) => pct(v, 1) },
              ]).map((it) => {
                const cur = lastNonNull(panel.factors[it.key] || []);
                const p = percentileOf(panel.factors[it.key] || [], cur);
                const extreme = p <= 0.1 || p >= 0.9;
                return (
                  <div key={it.key} className="stat">
                    <div className="k">{it.k}</div>
                    <div className="v">{cur == null ? '—' : it.f(cur)}</div>
                    <div className="p">перцентиль <b style={{ color: extreme ? 'var(--tk-blue)' : 'inherit' }}>{Math.round(p * 100)}%</b>{extreme ? ' · экстремум' : ''}</div>
                    <div className="pctbar"><span className="fillp" style={{ width: p * 100 + '%' }} /><i style={{ left: clamp(p * 100, 1, 99) + '%' }} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* chart + baseline */}
          <div className="grid2">
            <div className="card">
              <h2><span className="ht">{panel.symbol} · график по годам</span></h2>
              <p className="desc">Свой SVG из того же ряда, что и расчёты. Наведи курсор — состояние на дату.</p>
              <div className="toolbar">
                <span className="seg sm">
                  {RANGES.map((r) => <button key={r.label} className={chartRange === r.days ? 'active' : ''} onClick={() => setChartRange(r.days)}>{r.label}</button>)}
                </span>
                <span style={{ flex: 1 }} />
                <button className={'ghost' + (sma50On ? ' on' : '')} onClick={() => setSma50On((v) => !v)}>SMA50</button>
                <button className={'ghost' + (sma200On ? ' on' : '')} onClick={() => setSma200On((v) => !v)}>SMA200</button>
                <button className={'ghost' + (ddOn ? ' on' : '')} onClick={() => setDdOn((v) => !v)}>Просадки</button>
                <button className={'ghost' + (logOn ? ' on' : '')} onClick={() => setLogOn((v) => !v)}>Лог</button>
              </div>
              <Chart panel={panel} sma50On={sma50On} sma200On={sma200On} ddOn={ddOn} logOn={logOn} range={chartRange} tipRef={tipRef} hlRef={hlRef} />
              <div className="legend">
                <span><i style={{ background: 'var(--tk-blue)' }} />Цена</span>
                {sma50On && <span><i style={{ background: 'var(--tk-sma50)' }} />SMA50</span>}
                {sma200On && <span><i style={{ background: 'var(--tk-sma200)' }} />SMA200</span>}
                <span className="small">{panel.symbol} · {years[0]}–{years[years.length - 1]} · {panel.dates.length} баров</span>
              </div>
            </div>

            <div className="card">
              <h2><span className="ht">Baseline · {outLabel}</span></h2>
              <p className="desc">Безусловный исход ({outLabel}) — эталон, относительно которого читаются все таблицы. «Edge» = условное минус это.</p>
              <table>
                <tbody>
                  <tr><th className="l">Горизонт</th><th>n</th><th>сред.</th><th>медиана</th><th>hit</th><th>σ</th></tr>
                  {HZ.map((h) => {
                    const b = baselineStats(fwAll[String(h)] || []);
                    const cur = h === H;
                    return (
                      <tr key={h} style={cur ? { background: 'var(--tk-sel)' } : undefined}>
                        <td className="l">{h}д {cur && <span className="badge">выбран</span>}</td>
                        <td>{b.n}</td>
                        <td className={b.mean >= 0 ? 'pos' : 'neg'}>{pct(b.mean)}</td>
                        <td className={b.median >= 0 ? 'pos' : 'neg'}>{pct(b.median)}</td>
                        <td>{Math.round(b.hit * 100)}%</td>
                        <td className="mut">{pctRaw(b.std)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="small" style={{ marginTop: 10 }}>Безусловно за {H}д: <b>{pct(baseline.mean)}</b> ({outLabel}, hit {Math.round(baseline.hit * 100)}%). «edge» показывает, что добавляет <i>условие</i> сверх этого.</p>
            </div>
          </div>

          {/* AI draft */}
          <div className="card ai">
            <h2><span className="ht">AI-черновик гипотезы <span className="badge">отфильтровано: значимо + n_eff достаточно</span></span></h2>
            <p className="desc">Детерминированный пре-фильтр отбирает «что необычно сейчас И статистически держится», и только это формулируется как гипотеза.</p>
            <AiBox panel={panel} results={results} hidden={hidden} H={H} baselineMean={baseline.mean} outLabel={outLabel} />
          </div>

          {/* widgets */}
          <div className="layoutbar">
            <span className="lbl">Виджеты:</span>
            {WIDGETS.map((w) => (
              <span key={w.id} className={'chiptog' + (hidden.has(w.id) ? ' off' : '')}
                onClick={() => setHidden((s) => { const n = new Set(s); n.has(w.id) ? n.delete(w.id) : n.add(w.id); return n; })}>
                {w.title.split('→')[0].trim()}
              </span>
            ))}
          </div>
          <div className="widgets">
            {WIDGETS.filter((w) => !hidden.has(w.id)).map((w) => {
              const res = results[w.id];
              if (!res) return null;
              const open = !!openCfg[w.id];
              const selIdx = sel[w.id];
              return (
                <div key={w.id} className="card">
                  <h2>
                    <span className="ht">{w.title} <span className="badge">{H}д · {res.bins.length} бинов</span></span>
                    <button className={'gear' + (open ? ' on' : '')} title="Настройка границ"
                      onClick={() => setOpenCfg((o) => ({ ...o, [w.id]: !o[w.id] }))}>⚙</button>
                  </h2>
                  <p className="desc">{w.desc}</p>
                  {open && <CfgPanel w={w} cfg={binCfg[w.id]} nbins={res.bins.length} onMode={(m) => updateCfg(w.id, (c) => { c.mode = m; })}
                    onK={(d) => updateCfg(w.id, (c) => { c.k = clamp(c.k + d, 2, 8); })}
                    onN={(d) => updateCfg(w.id, (c) => { c.minN = clamp(c.minN + d, 5, 400); })}
                    onThr={(i, v) => updateCfg(w.id, (c) => { c.manual[i] = v / 100; c.manual = [...new Set(c.manual)].sort((a, b) => a - b); })}
                    onDel={(i) => updateCfg(w.id, (c) => { c.manual.splice(i, 1); })}
                    onAdd={() => updateCfg(w.id, (c) => { const last = c.manual[c.manual.length - 1] || 0; c.manual.push(+(last + 0.05).toFixed(4)); c.manual.sort((a, b) => a - b); })}
                    onReset={() => setBinCfg((prev) => ({ ...prev, [w.id]: JSON.parse(JSON.stringify(w.def)) }))} />}
                  <table>
                    <tbody>
                      <tr><th className="l">Бин условия</th><th>n</th><th>{mode === 'edge' ? 'edge' : 'сред.'}</th><th>hit</th><th>CI (n_eff)</th><th>5y</th></tr>
                      {res.bins.map((b, k) => {
                        const st = b.stat, isCur = k === res.curBin, isSel = selIdx === k;
                        const showVal = mode === 'edge' ? st.edge : st.mean;
                        const valCls = st.lowN ? 'mut' : (st.sig ? (showVal >= 0 ? 'pos' : 'neg') : 'mut');
                        return (
                          <FragmentRow key={k}>
                            <tr className={'bin' + (isCur ? ' cur' : '') + (isSel ? ' sel' : '') + (st.lowN ? ' muted' : '')}
                              onClick={() => setSel((s) => ({ ...s, [w.id]: s[w.id] === k ? undefined : k }))}>
                              <td className="l">{b.label}{isCur && <span className="badge cur-badge">сейчас</span>}</td>
                              <td>{st.n}</td>
                              <td className={valCls}>{pct(showVal)}<Dot st={st} /></td>
                              <td className={st.lowN ? 'mut' : ''}>{Math.round(st.hit * 100)}%</td>
                              <td><CiBar st={st} /></td>
                              <td><Spark ep={st.epEdge} /></td>
                            </tr>
                            {isSel && (
                              <tr className="detail-row"><td colSpan={6}>
                                <Detail panel={panel} w={w} binIdx={k} res={res} H={H} cfg={binCfg[w.id]} years={years} baselineMean={baseline.mean} fwAll={fwAll} outLabel={outLabel} />
                              </td></tr>
                            )}
                          </FragmentRow>
                        );
                      })}
                    </tbody>
                  </table>
                  <FlagsHint res={res} />
                </div>
              );
            })}
          </div>

          {/* corr */}
          <div className="card">
            <h2><span className="ht">Корреляция с ключевыми активами (по эпохам)</span></h2>
            <p className="desc">Набор активов настраивается (любой символ). <span className="mut">На одном тикере rolling-corr нестабильна — показываем уровни по эпохам, а не «режимы».</span></p>
            <div className="assets">
              {corrAssets.map((s) => (
                <span key={s} className="asset">{s}<button onClick={() => setCorrAssets((a) => a.filter((x) => x !== s))}>×</button></span>
              ))}
              <input placeholder="+ символ" autoComplete="off" spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const s = (e.target as HTMLInputElement).value.trim().toUpperCase();
                    if (s && !corrAssets.includes(s)) setCorrAssets((a) => [...a, s]);
                    (e.target as HTMLInputElement).value = '';
                  }
                }} />
            </div>
            <CorrGrid panel={panel} assets={corrAssets} series={corrSeries} years={years} />
          </div>

          <div className="small" style={{ marginTop: 16, color: 'var(--tk-soft)' }}>
            Данные: цены через единый кэш <code>getPrices</code> (EODHD→FMP), без ключей — синтетика. Бины/статистика считаются на клиенте (<code>@/lib/ticker/engine</code>). baseline+edge, n_eff/CI и серый-незначимо — честная подача неопределённости на одном инструменте.
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------- sub-components ----------------------------- */
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function Dot({ st }: { st: Bin['stat'] }) {
  if (st.lowN) return <span className="dot no" />;
  if (st.sig) return <span className={'dot ' + (st.edge > 0 ? 'sig' : 'signeg')} />;
  return <span className="dot no" />;
}
function CiBar({ st }: { st: Bin['stat'] }) {
  const R = 0.08, w = 84, mid = w / 2, x = (v: number) => mid + clamp(v / R, -1, 1) * mid;
  const a = x(st.ciLo), c2 = x(st.ciHi), m = x(st.edge);
  const col = st.sig ? (st.edge > 0 ? 'var(--tk-up)' : 'var(--tk-down)') : 'var(--tk-soft)';
  return (
    <span className="ci"><span className="cibar">
      <span className="zero" style={{ left: mid }} />
      <span className="rng" style={{ left: Math.min(a, c2), width: Math.abs(c2 - a), background: col }} />
      <span className="mid" style={{ left: m, background: col }} />
    </span></span>
  );
}
function Spark({ ep }: { ep: (number | null)[] }) {
  const max = Math.max(0.001, ...ep.filter((x): x is number => x != null).map((x) => Math.abs(x)));
  return (
    <span className="spark">
      {ep.map((e, i) => e == null
        ? <span key={i} className="s" style={{ height: 3, background: 'var(--tk-line2)' }} />
        : <span key={i} className="s" title={pct(e)} style={{ height: clamp(Math.abs(e) / max * 20, 2, 20), background: e > 0 ? 'var(--tk-up)' : 'var(--tk-down)' }} />)}
    </span>
  );
}
function FlagsHint({ res }: { res: BinResult }) {
  const tested = res.bins.filter((b) => !b.stat.lowN).length;
  const sig = res.bins.filter((b) => b.stat.sig).length;
  if (!tested) return null;
  return <p className="small" style={{ marginTop: 8 }}>Протестировано бинов: {tested} · значимых: {sig} · ожидаемо ложных при α=5%: ~{(0.05 * tested).toFixed(1)}. <span className="mut">Цвет — только если CI исключает baseline; серое — не доверять.</span></p>;
}

function CfgPanel(props: {
  w: Widget; cfg: BinCfg; nbins: number;
  onMode: (m: BinCfg['mode']) => void; onK: (d: number) => void; onN: (d: number) => void;
  onThr: (i: number, v: number) => void; onDel: (i: number) => void; onAdd: () => void; onReset: () => void;
}) {
  const { cfg } = props;
  const modes: [BinCfg['mode'], string][] = [['auto', 'Авто (кластеры)'], ['quantile', 'Квантили'], ['equal', 'Равные'], ['manual', 'Вручную']];
  return (
    <div className="cfg">
      <div className="cfgrow"><span className="cfglbl">Режим бинов</span><span className="seg sm">
        {modes.map(([m, l]) => <button key={m} className={cfg.mode === m ? 'active' : ''} onClick={() => props.onMode(m)}>{l}</button>)}
      </span></div>
      {cfg.mode !== 'manual' && (
        <div className="cfgrow"><span className="cfglbl">Число бинов</span>
          <span className="stepper"><button onClick={() => props.onK(-1)}>−</button><b>{cfg.k}</b><button onClick={() => props.onK(1)}>+</button></span>
        </div>
      )}
      {(cfg.mode === 'auto' || cfg.mode === 'equal') && (
        <div className="cfgrow"><span className="cfglbl">Мин. наблюдений / бин</span>
          <span className="stepper"><button onClick={() => props.onN(-10)}>−</button><b>{cfg.minN}</b><button onClick={() => props.onN(10)}>+</button></span>
          <span className="cfghint">мелкие бины сливаются — баланс «хвосты ↔ похожие»</span>
        </div>
      )}
      {cfg.mode === 'manual' && (
        <div className="cfgrow"><span className="cfglbl">Пороги (%)</span><span className="thr">
          {cfg.manual.map((t, i) => (
            <span key={i} className="thrchip">
              <input defaultValue={(t * 100).toFixed(Math.abs(t * 100 % 1) > 1e-9 ? 1 : 0)} inputMode="decimal"
                onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) props.onThr(i, v); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <span>%</span><button onClick={() => props.onDel(i)}>×</button>
            </span>
          ))}
          <button className="thradd" onClick={props.onAdd}>+ порог</button>
        </span></div>
      )}
      <div className="cfgrow"><button className="ghost" onClick={props.onReset}>Сбросить к дефолту</button>
        <span className="cfghint">текущих бинов: <b>{props.nbins}</b></span></div>
    </div>
  );
}

function Detail(props: {
  panel: TickerPanel; w: Widget; binIdx: number; res: BinResult; H: number; cfg: BinCfg;
  years: number[]; baselineMean: number; fwAll: Record<string, (number | null)[]>; outLabel: string;
}) {
  const { panel, w, binIdx, res, H, cfg, years, fwAll, outLabel } = props;
  const st = res.bins[binIdx].stat;
  const fwd = fwAll[String(H)] || [];

  // decay по горизонтам для этого бина
  const decay = HZ.map((h) => {
    const fwh = fwAll[String(h)] || [];
    const bs = baselineStats(fwh);
    const r = binStats(panel.factors[w.key] || [], fwh, years, cfg, w.unit, bs.mean, h);
    const bb = r.bins[binIdx] || r.bins[Math.min(binIdx, r.bins.length - 1)];
    return { h, edge: bb ? bb.stat.edge : 0, lowN: bb ? bb.stat.lowN : true };
  });
  const maxE = Math.max(0.001, ...decay.map((d) => Math.abs(d.edge)));
  const signs = decay.filter((d) => !d.lowN).map((d) => d.edge);
  const mono = signs.length >= 3 && (signs.every((v, i) => i === 0 || v >= signs[i - 1]) || signs.every((v, i) => i === 0 || v <= signs[i - 1]));

  // поведение ПО ГОДАМ для этого бина (на выбранном горизонте/исходе)
  const byYear = useMemoYears(st.members, fwd, years, props.baselineMean);
  const epOk = st.epEdge.filter((x): x is number => x != null);
  const sameSign = epOk.length ? epOk.filter((x) => Math.sign(x) === Math.sign(st.edge)).length : 0;
  const skew = Math.abs(st.mean - st.median) > 1.5 * st.std / 2;

  // похожие эпизоды (последние входы в бин)
  const eps = [...st.members].map((i) => ({ i, r: fwd[i] as number, d: panel.dates[i] })).filter((e) => e.r != null).sort((a, b) => b.i - a.i).slice(0, 8);
  const maxAbs = Math.max(0.001, ...eps.map((e) => Math.abs(e.r)));
  const maxYearAbs = Math.max(0.001, ...byYear.map((y) => Math.abs(y.edge)));

  return (
    <div className="detail">
      <div className="detail-top">
        <div className="detail-cell">
          <div className="small dt-title"><b>Decay по горизонтам</b> (edge) {mono
            ? <span className="flag good">монотонно — признак паттерна</span>
            : <span className="flag gray">немонотонно — вероятно шум</span>}</div>
          <div className="decay">
            {decay.map((d) => (
              <div key={d.h} className="b"><span>{pct(d.edge, 1)}</span>
                <span className="bar" style={{ height: clamp(Math.abs(d.edge) / maxE * 40, 2, 40), background: d.lowN ? 'var(--tk-soft)' : (d.edge > 0 ? 'var(--tk-up)' : 'var(--tk-down)') }} />
                <span>{d.h}д</span></div>
            ))}
          </div>
        </div>
        <div className="detail-cell">
          <div className="small dt-title"><b>Сводка бина</b> ({outLabel}, {H}д)</div>
          <div className="small">{epOk.length ? <>Стабильность: знак edge совпадает в <b>{sameSign} из {epOk.length}</b> 5-летних эпох.</> : 'Стабильность: недостаточно эпох.'}</div>
          <div className="small mut" style={{ marginTop: 4 }}>сред. {pct(st.mean)} · медиана {pct(st.median)} · baseline {pct(props.baselineMean)} · σ {pctRaw(st.std)} · n={st.n} (n_eff {st.neff.toFixed(0)}){skew && <> · <span style={{ color: 'var(--tk-warn)' }}>скошено/выбросы</span></>}</div>
        </div>
      </div>

      {/* поведение по годам */}
      <div className="detail-years">
        <div className="small dt-title"><b>Поведение по годам</b> · edge {outLabel} за {H}д (наведи — n/hit). Лет с данными: {byYear.length}</div>
        {byYear.length ? (
          <div className="years">
            {byYear.map((y) => (
              <div key={y.year} className="yb" title={`${y.year}: edge ${pct(y.edge)} · сред ${pct(y.mean)} · n=${y.n} · hit ${Math.round(y.hit * 100)}%`}>
                <span className="yv">{pct(y.edge, 0)}</span>
                <span className="ybar" style={{ height: clamp(Math.abs(y.edge) / maxYearAbs * 36, 2, 36), background: y.n < 5 ? 'var(--tk-soft)' : (y.edge > 0 ? 'var(--tk-up)' : 'var(--tk-down)') }} />
                <span className="yl">{String(y.year).slice(2)}</span>
              </div>
            ))}
          </div>
        ) : <div className="small mut">Недостаточно наблюдений по годам.</div>}
      </div>

      {/* похожие эпизоды */}
      <div className="detail-eps">
        <div className="small dt-title"><b>Похожие эпизоды</b> (последние входы в бин, исход {outLabel} за {H}д):</div>
        {eps.map((e) => (
          <div key={e.i} className="ep"><span className="mut">{e.d}</span>
            <span className="epbar" style={{ background: e.r >= 0 ? 'var(--tk-up)' : 'var(--tk-down)', width: Math.max(6, Math.abs(e.r) / maxAbs * 100) + '%' }} />
            <span className={e.r >= 0 ? 'pos' : 'neg'} style={{ textAlign: 'right' }}>{pct(e.r)}</span></div>
        ))}
      </div>
    </div>
  );
}

// Группировка наблюдений бина по календарным годам.
function useMemoYears(members: number[], fwd: (number | null)[], years: number[], baseMean: number) {
  return useMemo(() => {
    const m = new Map<number, number[]>();
    for (const i of members) { const v = fwd[i]; if (v == null) continue; const y = years[i]; if (!m.has(y)) m.set(y, []); (m.get(y) as number[]).push(v); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, vals]) => {
      const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
      return { year, n: vals.length, mean, edge: mean - baseMean, hit: vals.filter((x) => x > 0).length / vals.length };
    });
  }, [members, fwd, years, baseMean]);
}

function AiBox({ panel, results, hidden, H, baselineMean, outLabel }: { panel: TickerPanel; results: Record<string, BinResult>; hidden: Set<string>; H: number; baselineMean: number; outLabel: string }) {
  const findings = WIDGETS.filter((w) => !hidden.has(w.id)).map((w) => {
    const res = results[w.id];
    if (!res || res.curBin < 0) return null;
    const b = res.bins[res.curBin];
    const curPctl = percentileOf(panel.factors[w.key] || [], res.curVal);
    return { w, b, st: b.stat, curPctl };
  }).filter(Boolean) as { w: Widget; b: Bin; st: Bin['stat']; curPctl: number }[];
  const strong = findings.filter((f) => f.st.sig && !f.st.lowN);
  const weak = findings.filter((f) => !f.st.sig || f.st.lowN);
  return (
    <div>
      <div className="small" style={{ marginBottom: 6 }}>Тикер <b>{panel.symbol}</b>, горизонт {H}д, исход — {outLabel}, baseline {pct(baselineMean)}.</div>
      {!strong.length ? (
        <div className="hyp weak">Сейчас по текущему состоянию <b>нет статистически устойчивых паттернов</b> (после учёта n_eff и сравнения с baseline). Это честный результат: большинство условных эффектов на одном тикере — дрейф или шум.
          <div className="meta">Не выдаём слабые находки за сигнал. Попробуй другой горизонт/тикер/исход или измени границы бинов (⚙).</div></div>
      ) : strong.slice(0, 3).map((f, i) => {
        const dir = f.st.edge > 0 ? 'выше' : 'ниже';
        const unstable = f.st.epEdge.filter((x): x is number => x != null && Math.sign(x) === Math.sign(f.st.edge)).length < 3;
        return (
          <div key={i} className="hyp"><b>{f.w.title.split('→')[0].trim()}:</b> тикер сейчас в бине «{f.b.label}» (перцентиль {Math.round(f.curPctl * 100)}%). Исторически след. {H}д {outLabel} <b className={f.st.edge > 0 ? 'pos' : 'neg'}>{pct(f.st.edge)} {dir} baseline</b> (hit {Math.round(f.st.hit * 100)}%, n={f.st.n}, n_eff {f.st.neff.toFixed(0)}, CI {pct(f.st.ciLo)}…{pct(f.st.ciHi)}).
            <div className="meta">→ Гипотеза: при таком состоянии есть смещение исхода. Проверить вне выборки{unstable && <> — <span style={{ color: 'var(--tk-warn)' }}>нестабильно по эпохам</span></>}.</div></div>
        );
      })}
      {!!weak.length && <div className="small mut" style={{ marginTop: 8 }}>Отброшено как недостаточное: {weak.map((f) => f.w.title.split('→')[0].trim()).join(', ')} (малый n_eff или CI накрывает baseline).</div>}
    </div>
  );
}

function Chart({ panel, sma50On, sma200On, ddOn, logOn, range, tipRef, hlRef }: {
  panel: TickerPanel; sma50On: boolean; sma200On: boolean; ddOn: boolean; logOn: boolean; range: number;
  tipRef: React.RefObject<HTMLDivElement | null>; hlRef: React.RefObject<SVGLineElement | null>;
}) {
  const W = 560, Hh = 240, pad = { l: 38, r: 8, t: 8, b: 18 };
  const geom = useMemo(() => {
    const c = panel.close, n = c.length;
    const s0 = range > 0 ? Math.max(0, n - range) : 0; // начало видимого окна
    const span = Math.max(1, n - 1 - s0);
    const step = Math.max(1, Math.ceil((n - s0) / 700));
    const xs = (i: number) => pad.l + ((i - s0) / span) * (W - pad.l - pad.r);
    let lo = Infinity, hi = -Infinity;
    for (let i = s0; i < n; i++) { if (c[i] < lo) lo = c[i]; if (c[i] > hi) hi = c[i]; }
    if (!(lo < hi)) { lo = c[s0] * 0.99; hi = c[s0] * 1.01; }
    const yfn = (v: number) => logOn
      ? pad.t + (1 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (Hh - pad.t - pad.b)
      : pad.t + (1 - (v - lo) / (hi - lo)) * (Hh - pad.t - pad.b);
    const path = (sarr: (number | null)[]) => {
      let d = '', first = true;
      for (let i = s0; i < n; i += step) { const v = sarr[i]; if (v == null) { first = true; continue; } d += (first ? 'M' : 'L') + xs(i).toFixed(1) + ' ' + yfn(v).toFixed(1) + ' '; first = false; }
      return d;
    };
    const gridArr: { x: number; y: string }[] = [];
    let lastY = -1;
    const yearStep = span > 252 * 12 ? 5 : span > 252 * 4 ? 2 : 1;
    for (let i = s0; i < n; i += step) { const y = +panel.dates[i].slice(0, 4); if (y !== lastY && y % yearStep === 0) { gridArr.push({ x: xs(i), y: String(y) }); lastY = y; } }
    const dd: { x: number }[] = [];
    if (ddOn) { let m = -Infinity; for (let i = 0; i < n; i++) { if (c[i] > m) m = c[i]; if (i >= s0 && i % step === 0 && c[i] / m - 1 < -0.15) dd.push({ x: xs(i) }); } }
    const yticks = [0, 1, 2, 3, 4].map((k) => { const v = logOn ? Math.exp(Math.log(lo) + (k / 4) * (Math.log(hi) - Math.log(lo))) : lo + (k / 4) * (hi - lo); return { y: yfn(v), v }; });
    return { n, s0, span, step, xs, priceD: path(c), sma50D: path(panel.sma50), sma200D: path(panel.sma200), gridArr, dd, yticks };
  }, [panel, logOn, ddOn, range]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget, r = svg.getBoundingClientRect();
    const xpix = (e.clientX - r.left) / r.width * W;
    const i = clamp(Math.round(geom.s0 + ((xpix - pad.l) / (W - pad.l - pad.r)) * geom.span), geom.s0, geom.n - 1);
    const x = geom.xs(i);
    if (hlRef.current) { hlRef.current.setAttribute('x1', String(x)); hlRef.current.setAttribute('x2', String(x)); hlRef.current.setAttribute('opacity', '1'); }
    const tip = tipRef.current;
    if (tip) {
      tip.style.opacity = '1'; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 10) + 'px';
      const f = panel.factors;
      tip.innerHTML = `<b>${panel.dates[i]}</b><br>цена ${panel.close[i].toFixed(2)}<br>ATH ${f.distAth[i] != null ? pctRaw(f.distAth[i] as number) : '—'} · SMA200 ${f.smaDist200[i] != null ? pct(f.smaDist200[i] as number) : '—'}<br>вола ${f.vol21[i] != null ? pctRaw(f.vol21[i] as number, 0) : '—'}`;
    }
  }
  function onLeave() {
    if (hlRef.current) hlRef.current.setAttribute('opacity', '0');
    if (tipRef.current) tipRef.current.style.opacity = '0';
  }

  return (
    <div className="chartwrap">
      <svg viewBox={`0 0 ${W} ${Hh}`} onMouseMove={onMove} onMouseLeave={onLeave}>
        {geom.dd.map((d, i) => <rect key={'d' + i} x={d.x} y={pad.t} width={(W / 700) * 1.6} height={Hh - pad.t - pad.b} fill="var(--tk-down)" opacity="0.13" />)}
        {geom.gridArr.map((g, i) => <g key={'g' + i}><line x1={g.x} y1={pad.t} x2={g.x} y2={Hh - pad.b} stroke="var(--tk-line)" /><text x={g.x + 2} y={Hh - 6} fontSize="9" fill="var(--tk-soft)">{g.y}</text></g>)}
        {geom.yticks.map((t, i) => <text key={'y' + i} x="2" y={t.y + 3} fontSize="9" fill="var(--tk-soft)">{t.v < 10 ? t.v.toFixed(1) : Math.round(t.v)}</text>)}
        {sma200On && <path d={geom.sma200D} fill="none" stroke="var(--tk-sma200)" strokeWidth="1.2" opacity="0.9" />}
        {sma50On && <path d={geom.sma50D} fill="none" stroke="var(--tk-sma50)" strokeWidth="1.2" opacity="0.9" />}
        <path d={geom.priceD} fill="none" stroke="var(--tk-blue)" strokeWidth="1.4" />
        <line ref={hlRef} x1="0" y1={pad.t} x2="0" y2={Hh - pad.b} stroke="var(--tk-soft)" strokeDasharray="3 3" opacity="0" />
      </svg>
      <div ref={tipRef} className="tip" />
    </div>
  );
}

function CorrGrid({ panel, assets, series, years }: { panel: TickerPanel; assets: string[]; series: Record<string, [string, number][]>; years: number[] }) {
  const minY = years.length ? Math.min(...years) : 2005;
  const maxY = years.length ? Math.max(...years) : 2025;
  const span = Math.max(1, Math.ceil((maxY - minY + 1) / 4));
  const epR: [number, number][] = [0, 1, 2, 3].map((k) => [minY + k * span, Math.min(maxY, minY + (k + 1) * span - 1)] as [number, number]);
  const epLbl = epR.map(([a, b]) => `${String(a).slice(2)}–${String(b).slice(2)}`);

  const tRet = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 1; i < panel.close.length; i++) m.set(panel.dates[i], panel.close[i] / panel.close[i - 1] - 1);
    return m;
  }, [panel]);
  function assetRet(sym: string): Map<string, number> {
    const arr = series[sym] || [];
    const m = new Map<string, number>();
    for (let i = 1; i < arr.length; i++) { const prev = arr[i - 1][1]; if (prev) m.set(arr[i][0], arr[i][1] / prev - 1); }
    return m;
  }
  function corrIn(aRet: Map<string, number>, a: number, b: number): number | null {
    const xs: number[] = [], ys: number[] = [];
    for (const [d, tr] of tRet) { const y = +d.slice(0, 4); if (y >= a && y <= b) { const ar = aRet.get(d); if (ar != null) { xs.push(tr); ys.push(ar); } } }
    if (xs.length < 20) return null;
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  }
  return (
    <div className="corrgrid" style={{ gridTemplateColumns: `auto repeat(4,1fr)` }}>
      <div className="h" />
      {epLbl.map((e, i) => <div key={i} className="h">{e}</div>)}
      {!assets.length && <div className="mut" style={{ gridColumn: '1/-1', padding: 10 }}>Добавь активы для сравнения.</div>}
      {assets.map((sym) => {
        const aRet = assetRet(sym);
        return (
          <FragmentRow key={sym}>
            <div className="h l" style={{ textAlign: 'left' }}>{sym}</div>
            {epR.map(([a, b], i) => {
              const r = corrIn(aRet, a, b);
              if (r == null) return <div key={i} className="mut">—</div>;
              const t = (r + 1) / 2;
              const bg = `rgb(${Math.round(220 - t * 150)},${Math.round(80 + t * 150)},${Math.round(90 + (1 - Math.abs(r)) * 60)})`;
              return <div key={i} style={{ background: bg, color: Math.abs(r) > 0.4 ? '#fff' : '#0b0d12', borderRadius: 4, fontWeight: 600 }}>{r.toFixed(2)}</div>;
            })}
          </FragmentRow>
        );
      })}
    </div>
  );
}
