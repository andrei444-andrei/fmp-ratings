'use client';

// Скринер (боевая версия). Дизайн 1:1 с утверждённым прототипом (researcher.css, токены --fk-*).
// Сервер отдаёт ПАНЕЛЬ СДЕЛОК один раз; условия/разрезы/метрики оценки/провал считаются мгновенно на клиенте.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './researcher.css';
import {
  screenByTicker, screenByYear, screenDeals, dealStats, totalConds,
  type ScreenPanel, type Block, type Cmp,
} from '@/lib/signals/screen';

const GROUPS: Record<string, string[]> = {
  'Секторные ETF': ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'],
  'Страновые ETF': ['EWJ', 'EWG', 'EWU', 'EWZ', 'INDA', 'EWA', 'EWC', 'FXI', 'EWY', 'EWT'],
  'Сырьё': ['GLD', 'SLV', 'USO', 'UNG', 'DBA', 'DBB', 'DBC', 'PALL', 'PPLT', 'CORN'],
  'Металлы': ['GLD', 'SLV', 'PPLT', 'PALL', 'CPER', 'URA', 'URNM', 'GDX', 'SIL'],
  'Темы': ['SMH', 'SOXX', 'ARKK', 'ICLN', 'TAN', 'LIT', 'URA', 'BOTZ', 'HACK', 'SKYY'],
  'Крупные акции': ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'XOM'],
};
const METRICS: Record<string, { label: string; periods: number[]; unit: string }> = {
  momentum: { label: 'Моментум', periods: [21, 63, 126, 252], unit: '%' },
  vol: { label: 'Волатильность', periods: [21, 63], unit: '%' },
  dist_ath: { label: 'Расст. от ATH', periods: [0], unit: '%' },
  xbench: { label: 'Превышение бенч.', periods: [63], unit: 'пп' },
  sma_dist: { label: 'Откл. от SMA', periods: [50, 200], unit: '%' },
  rsi: { label: 'RSI', periods: [14], unit: '' },
};
const MID = Object.keys(METRICS);
const colOf = (id: string, p: number) => `${id}_${p}`;
const mlabel = (id: string, p: number) => METRICS[id].label + (METRICS[id].periods.length > 1 ? ` ${p}` : '');
const HORIZONS = [5, 10, 21, 63];

type UCond = { id: string; p: number; cmp: Cmp; val: number; not: boolean };
type UBlock = { conds: UCond[] };
type Disp = { id: string; p: number };

const toBlocks = (bs: UBlock[]): Block[] => bs.map((b) => ({ conds: b.conds.map((c) => ({ col: colOf(c.id, c.p), cmp: c.cmp, val: c.val, not: c.not })) }));
const cls = (v: number | null) => (v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const fnum = (v: number | null, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));

function FwdBar({ v }: { v: number }) {
  const w = Math.min(50, Math.abs(v) * 2.2);
  return (
    <span className="barpos">
      <span className={cls(v)}>{fnum(v)}</span>
      <span className="bar"><i style={{ [v >= 0 ? 'left' : 'right']: '50%', width: `${w}%`, background: v >= 0 ? 'var(--fk-up,#12b981)' : 'var(--fk-down,#f43f5e)' } as any} /></span>
    </span>
  );
}
// Колонка-число с цветом (без бара) — компактно для дополнительных метрик оценки.
const Num = ({ v, d = 1 }: { v: number | null; d?: number }) => <span className={cls(v)}>{fnum(v, d)}</span>;

export default function Researcher() {
  const [group, setGroup] = useState('Сырьё');
  const [uniText, setUniText] = useState(GROUPS['Сырьё'].join(', '));
  const [horizon, setHorizon] = useState(21);
  const [years, setYears] = useState(10); // окно статистики, лет (по умолчанию последние 10)
  const [blocks, setBlocks] = useState<UBlock[]>([
    { conds: [{ id: 'momentum', p: 63, cmp: 'ge', val: 10, not: false }, { id: 'vol', p: 21, cmp: 'le', val: 30, not: false }] },
  ]);
  const [display, setDisplay] = useState<Disp[]>([{ id: 'momentum', p: 63 }, { id: 'vol', p: 21 }, { id: 'rsi', p: 14 }]);
  const [view, setView] = useState<'tickers' | 'years'>('tickers');
  const [panel, setPanel] = useState<ScreenPanel | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [drill, setDrill] = useState<{ kind: 't' | 'y'; kv: string } | null>(null);

  const universe = useMemo(() => [...new Set(uniText.toUpperCase().split(/[^A-Z0-9.\-]+/).filter(Boolean))].slice(0, 40), [uniText]);

  const fetchPanel = useCallback(async (uni: string[], hz: number) => {
    if (uni.length < 1) { setPanel(null); return; }
    setLoading(true); setErr('');
    try {
      // Подготовленная панель: кэш-первым с бэка (мгновенно), Pyodide — только на новые тикеры.
      const res = await fetch('/api/researcher/panel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ universe: uni, horizon: hz }),
      });
      const out = await res.json().catch(() => ({}));
      if (out?.error) throw new Error(out.error);
      setPanel(out && out.mode === 'screen' ? out : null);
    } catch (ex: any) { setErr(ex?.message || 'ошибка'); setPanel(null); } finally { setLoading(false); }
  }, []);

  const t = useRef<any>(null);
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => fetchPanel(universe, horizon), 350);
    return () => clearTimeout(t.current);
  }, [universe.join(','), horizon, fetchPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Границы окна лет по панели.
  const lastYear = panel ? +String(panel.meta?.last || panel.dates[panel.dates.length - 1] || '').slice(0, 4) || null : null;
  const firstYear = panel ? +String(panel.meta?.first || panel.dates[0] || '').slice(0, 4) || null : null;
  const spanYears = lastYear && firstYear ? lastYear - firstYear + 1 : null;
  const minYear = lastYear != null ? lastYear - years + 1 : undefined;

  const blk = toBlocks(blocks);
  const displayCols = display.map((d) => colOf(d.id, d.p));
  const byT = useMemo(() => (panel ? screenByTicker(panel, blk, displayCols, minYear) : []), [panel, blocks, display, minYear]); // eslint-disable-line react-hooks/exhaustive-deps
  const byY = useMemo(() => (panel ? screenByYear(panel, blk, minYear) : []), [panel, blocks, minYear]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchedN = byY.reduce((a, y) => a + y.n, 0);
  const setB = (f: (b: UBlock[]) => UBlock[]) => setBlocks((prev) => f(structuredClone(prev)));
  const tColSpan = 9 + display.length;

  // Шапка форвард-метрик оценки (общая для тикеров/годов): Доля + · Ср.return · Медиана · Просадка · MAE · MFE · vs SPY.
  const outHead = (
    <>
      <th title="Hit-rate: доля сделок с положительным форвардным возвратом">Доля +</th>
      <th title={`Средний форвардный возврат за ${horizon}д`}>Ср. return</th>
      <th title="Медианный форвардный возврат">Медиана</th>
      <th title="Средняя макс. просадка пути после входа (peak-to-trough)">Просадка</th>
      <th title="Средняя макс. неблагоприятная экскурсия (MAE)">MAE</th>
      <th title="Средняя макс. благоприятная экскурсия (MFE)">MFE</th>
      <th title="Среднее превышение бенчмарка (SPY) за горизонт">vs SPY</th>
    </>
  );
  const outCells = (s: { hitPct: number; avgRet: number; medRet: number; avgMdd: number; avgMae: number; avgMfe: number; avgExc: number }) => (
    <>
      <td className="num">{s.hitPct.toFixed(0)}%</td>
      <td className="num"><Num v={s.avgRet} /></td>
      <td className="num"><Num v={s.medRet} /></td>
      <td className="num down">{fnum(s.avgMdd)}</td>
      <td className="num down">{fnum(s.avgMae)}</td>
      <td className="num up">{fnum(s.avgMfe)}</td>
      <td><FwdBar v={s.avgExc} /></td>
    </>
  );

  return (
    <main className="rsx" style={{ maxWidth: 1320, margin: '0 auto', padding: '20px 20px 90px' }}>
      <div className="top">
        <h1>Скринер</h1>
        <span className="badge brand">боевая версия</span>
        <span className="sub">Вселенная → условия (блоки ИЛИ, внутри И/НЕ) → метрики оценки за горизонт (return / hit-rate / просадка / MAE·MFE) в окне лет → провал в сделки. Пересчёт мгновенный на клиенте.</span>
      </div>

      {/* 1. Вселенная */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="card-t">1 · Вселенная</span>
            <span className="sub">{universe.length} тикеров{loading ? ' · загрузка…' : ''}</span>
          </div>
          <div className="grp">
            {Object.keys(GROUPS).map((g) => (
              <button key={g} type="button" className={`chip${group === g ? ' on' : ''}`} onClick={() => { setGroup(g); setUniText(GROUPS[g].join(', ')); }}>
                {g}<span className="n">{GROUPS[g].length}</span>
              </button>
            ))}
          </div>
          <textarea className="uni" value={uniText} spellCheck={false} onChange={(e) => { setUniText(e.target.value); setGroup(''); }} />
          <p className="sub" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Пресет — стартовый набор; список правится свободно (до 40).</span>
            <span className="hz">Горизонт (X дней):{HORIZONS.map((h) => <button key={h} type="button" className={horizon === h ? 'on' : ''} onClick={() => setHorizon(h)}>{h}д</button>)}</span>
          </p>
          <div className="yrs">
            <span className="lbl">Окно статистики:</span>
            <input type="range" min={1} max={Math.max(spanYears || 25, 10)} value={years} onChange={(e) => setYears(+e.target.value)} />
            <span className="val num">последние {years} {years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}{minYear ? ` (с ${minYear})` : ''}</span>
            {spanYears && <span className="sub">из {spanYears} доступных</span>}
          </div>
          {err && <p className="sub" style={{ color: 'var(--fk-down-text,#c81e3c)', fontWeight: 600, marginTop: 6 }}>Ошибка: {err}</p>}
        </div>
      </div>

      {/* 2. Условия */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="card-t">2 · Условия отбора</span>
            <span className="sub">блоки = <b style={{ color: 'var(--fk-brand-700)' }}>ИЛИ</b> · внутри блока — <b>И</b> / <b style={{ color: 'var(--fk-down-text,#c81e3c)' }}>НЕ</b></span>
          </div>
          <div className="blocks">
            {blocks.map((b, bi) => (
              <div key={bi}>
                {bi > 0 && <div className="or-div"><span className="ln" /><span className="pill">ИЛИ</span><span className="ln" /></div>}
                <div className="block">
                  <div className="block-h">
                    <span className="lbl">Блок {bi + 1}</span>
                    <span className="x" onClick={() => setB((bb) => { bb.splice(bi, 1); if (!bb.length) bb.push({ conds: [] }); return bb; })}>удалить блок</span>
                  </div>
                  {b.conds.map((c, ci) => (
                    <div className="cond" key={ci}>
                      <button className={`nott${c.not ? ' on' : ''}`} onClick={() => setB((bb) => { bb[bi].conds[ci].not = !bb[bi].conds[ci].not; return bb; })}>{c.not ? 'НЕ' : 'И'}</button>
                      <select value={c.id} onChange={(e) => setB((bb) => { const id = e.target.value; bb[bi].conds[ci].id = id; if (!METRICS[id].periods.includes(bb[bi].conds[ci].p)) bb[bi].conds[ci].p = METRICS[id].periods[0]; return bb; })}>
                        {MID.map((id) => <option key={id} value={id}>{METRICS[id].label}</option>)}
                      </select>
                      <select value={c.p} disabled={METRICS[c.id].periods.length < 2} onChange={(e) => setB((bb) => { bb[bi].conds[ci].p = +e.target.value; return bb; })}>
                        {METRICS[c.id].periods.map((p) => <option key={p} value={p}>{p === 0 ? 'всё' : `${p}д`}</option>)}
                      </select>
                      <div className="seg">
                        {(['ge', 'le'] as Cmp[]).map((cm) => <button key={cm} className={c.cmp === cm ? 'on' : ''} onClick={() => setB((bb) => { bb[bi].conds[ci].cmp = cm; return bb; })}>{cm === 'ge' ? '≥' : '≤'}</button>)}
                      </div>
                      <input className="val" defaultValue={c.val} inputMode="decimal" onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) setB((bb) => { bb[bi].conds[ci].val = n; return bb; }); }} />
                      <span className="x" onClick={() => setB((bb) => { bb[bi].conds.splice(ci, 1); return bb; })}>✕</span>
                    </div>
                  ))}
                  <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setB((bb) => { bb[bi].conds.push({ id: 'momentum', p: 63, cmp: 'ge', val: 10, not: false }); return bb; })}>+ И условие</button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setBlocks((p) => [...p, { conds: [{ id: 'rsi', p: 14, cmp: 'le', val: 35, not: false }] }])}>+ ИЛИ — новый блок</button>
        </div>
      </div>

      {/* 3. Метрики в таблице */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="card-t">3 · Факторы на входе (для показа)</span><span className="sub">любые столбцы-факторы, даже если не в условиях · метрики оценки показываются всегда</span>
          </div>
          <div className="dchips">
            {MID.flatMap((id) => METRICS[id].periods.map((p) => ({ id, p }))).map((o) => {
              const on = display.some((d) => d.id === o.id && d.p === o.p);
              return <button key={`${o.id}_${o.p}`} className={`dc${on ? ' on' : ''}`} onClick={() => setDisplay((d) => on ? d.filter((x) => !(x.id === o.id && x.p === o.p)) : [...d, o])}>{mlabel(o.id, o.p)}</button>;
            })}
          </div>
        </div>
      </div>

      {/* 4. Результаты */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span className="card-t">4 · Результаты</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="sub">{!panel ? '' : totalConds(blk) ? `${matchedN} сделок прошли · ${byT.length} тикеров` : `все сделки (${matchedN})`}</span>
              <div className="seg" style={{ width: 'auto' }}>
                {(['tickers', 'years'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} style={{ padding: '4px 10px' }}>{v === 'tickers' ? 'По тикерам' : 'По годам'}</button>)}
              </div>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {!panel ? (
              <p className="sub" style={{ textAlign: 'center', padding: '36px 0' }}>{loading ? 'Загружаю панель сделок…' : 'Выберите вселенную.'}</p>
            ) : view === 'tickers' ? (
              <table>
                <thead><tr><th className="l">Тикер</th><th>Сделок</th>{display.map((o) => <th key={`${o.id}_${o.p}`}>{mlabel(o.id, o.p)}</th>)}{outHead}</tr></thead>
                <tbody>
                  {byT.map((r) => (
                    <tr key={r.symbol} className="click" onClick={() => setDrill({ kind: 't', kv: r.symbol })}>
                      <td className="l"><span className="sy">{r.symbol}</span></td><td className="num">{r.n}</td>
                      {r.disp.map((v, i) => <td key={i} className={`num ${cls(v)}`}>{v == null ? '—' : display[i].id === 'rsi' ? v.toFixed(0) : fnum(v)}</td>)}
                      {outCells(r)}
                    </tr>
                  ))}
                  {!byT.length && <tr><td className="l sub" colSpan={tColSpan} style={{ padding: 20 }}>Ничего не прошло условия — ослабьте блоки или расширьте окно лет.</td></tr>}
                </tbody>
              </table>
            ) : (
              <table>
                <thead><tr><th className="l">Год</th><th>Сделок</th><th>Тикеров</th>{outHead}</tr></thead>
                <tbody>
                  {byY.map((y) => (
                    <tr key={y.year} className="click" onClick={() => setDrill({ kind: 'y', kv: String(y.year) })}>
                      <td className="l"><span className="sy">{y.year}</span></td><td className="num">{y.n}</td><td className="num">{y.tickers}</td>
                      {outCells(y)}
                    </tr>
                  ))}
                  {!byY.length && <tr><td className="l sub" colSpan={10} style={{ padding: 20 }}>Нет сделок в окне лет.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          {panel && <p className="foot">Клик по строке → провал внутрь сделок. Панель: {panel.meta?.obs} сделок, {panel.symbols.length} тикеров, {panel.meta?.first} … {panel.meta?.last} · форвард {panel.horizon}д · окно {years} лет{minYear ? ` (с ${minYear})` : ''}.</p>}
        </div>
      </div>

      {drill && panel && <Drawer panel={panel} blocks={blk} drill={drill} horizon={panel.horizon || horizon} minYear={minYear} onClose={() => setDrill(null)} />}
    </main>
  );
}

function Drawer({ panel, blocks, drill, horizon, minYear, onClose }: { panel: ScreenPanel; blocks: Block[]; drill: { kind: 't' | 'y'; kv: string }; horizon: number; minYear?: number; onClose: () => void }) {
  const deals = screenDeals(panel, blocks, drill.kind, drill.kv, minYear);
  const st = dealStats(deals);
  const stats: [string, string, string][] = [
    ['Сделок', String(st.n), ''],
    ['Доля +', st.hitPct.toFixed(0) + '%', ''],
    ['Ср. return', fnum(st.avgRet) + '%', cls(st.avgRet)],
    ['Медиана', fnum(st.medRet) + '%', cls(st.medRet)],
    ['Просадка', fnum(st.avgMdd) + '%', 'down'],
    ['MAE', fnum(st.avgMae) + '%', 'down'],
    ['MFE', fnum(st.avgMfe) + '%', 'up'],
    ['vs SPY', fnum(st.avgExc) + '%', cls(st.avgExc)],
  ];
  return (
    <div className="rsx">
      <div className="rsx-scrim" onClick={onClose} />
      <div className="rsx-drawer">
        <div className="dr-h">
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>{drill.kind === 't' ? `${drill.kv} · сделки` : `Год ${drill.kv} · сделки`}</div><div className="sub" style={{ marginTop: 3 }}>матч-сделки по текущим условиям · форвард {horizon}д{drill.kind === 'y' ? '' : minYear ? ` · с ${minYear}` : ''} · {st.tickers} тикеров</div></div>
          <span className="x" onClick={onClose}>✕</span>
        </div>
        <div className="dr-b">
          <div className="statgrid">
            {stats.map(([k, v, tone]) => (
              <div className="stat" key={k}><div className="k">{k}</div><div className={`v ${tone}`}>{v}</div></div>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th className="l">Дата</th>{drill.kind === 'y' && <th className="l">Тикер</th>}<th>Момент. 63</th><th>Вола 21</th><th>RSI</th><th>Return</th><th>MFE</th><th>MAE</th><th>Просадка</th><th>vs SPY</th></tr></thead>
              <tbody>
                {deals.map((d, i) => (
                  <tr key={i}>
                    <td className="l num">{d.date}</td>{drill.kind === 'y' && <td className="l sy">{d.symbol}</td>}
                    <td className={`num ${cls(d.vals.momentum_63)}`}>{fnum(d.vals.momentum_63)}</td>
                    <td className="num">{d.vals.vol_21 ?? '—'}</td><td className="num">{d.vals.rsi_14 ?? '—'}</td>
                    <td><FwdBar v={d.ret} /></td>
                    <td className="num up">{fnum(d.mfe)}</td><td className="num down">{fnum(d.mae)}</td><td className="num down">{fnum(d.mdd)}</td>
                    <td className="num"><Num v={d.exc} /></td>
                  </tr>
                ))}
                {!deals.length && <tr><td className="l sub" colSpan={drill.kind === 'y' ? 10 : 9} style={{ padding: 16 }}>Нет сделок в окне лет.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
