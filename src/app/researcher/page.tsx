'use client';

// Скринер (боевая версия). Дизайн 1:1 с утверждённым прототипом (researcher.css, токены --fk-*).
// Сервер отдаёт ПАНЕЛЬ СДЕЛОК один раз; условия/формулы/разрезы/метрики оценки/провал считаются мгновенно на клиенте.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './researcher.css';
import {
  screenByTicker, screenByYear, screenDeals, dealStats, totalConds,
  type ScreenPanel, type Block, type Cmp, type Formulas, type CellFn,
} from '@/lib/signals/screen';
import { compileFormula } from '@/lib/signals/formula';

const GROUPS: Record<string, string[]> = {
  'Секторные ETF': ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'],
  'Страновые ETF': ['EWJ', 'EWG', 'EWU', 'EWZ', 'INDA', 'EWA', 'EWC', 'FXI', 'EWY', 'EWT'],
  'Сырьё': ['GLD', 'SLV', 'USO', 'UNG', 'DBA', 'DBB', 'DBC', 'PALL', 'PPLT', 'CORN'],
  'Металлы': ['GLD', 'SLV', 'PPLT', 'PALL', 'CPER', 'URA', 'URNM', 'GDX', 'SIL'],
  'Темы': ['SMH', 'SOXX', 'ARKK', 'ICLN', 'TAN', 'LIT', 'URA', 'BOTZ', 'HACK', 'SKYY'],
  'Крупные акции': ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'XOM'],
};
const METRICS: Record<string, { label: string; periods: number[]; unit: string }> = {
  momentum: { label: 'Моментум', periods: [5, 21, 63, 126, 252], unit: '%' },
  vol: { label: 'Волатильность', periods: [21, 63], unit: '%' },
  dist_ath: { label: 'Расст. от ATH', periods: [0], unit: '%' },
  xbench: { label: 'Превышение бенч.', periods: [5, 21, 63, 126, 252], unit: 'пп' },
  sma_dist: { label: 'Откл. от SMA', periods: [50, 200], unit: '%' },
  rsi: { label: 'RSI', periods: [14], unit: '' },
};
const MID = Object.keys(METRICS);
const colOf = (id: string, p: number) => `${id}_${p}`;
const mlabel = (id: string, p: number) => METRICS[id].label + (METRICS[id].periods.length > 1 ? ` ${p}` : '');
// Все базовые колонки-факторы (для выбора в условиях и столбцах + валидации формул).
const BASE_COLS = MID.flatMap((id) => METRICS[id].periods.map((p) => ({ key: colOf(id, p), id, label: mlabel(id, p) })));
const BASE_KEYS = new Set(BASE_COLS.map((c) => c.key));
const HORIZONS = [5, 10, 21, 63];

type UCond = { col: string; cmp: Cmp; val: number; not: boolean };
type UBlock = { conds: UCond[] };
type FormulaDef = { id: string; name: string; expr: string };

const cls = (v: number | null) => (v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const fnum = (v: number | null, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
const isRsiKey = (k: string) => k.startsWith('rsi');

function FwdBar({ v }: { v: number }) {
  const w = Math.min(50, Math.abs(v) * 2.2);
  return (
    <span className="barpos">
      <span className={cls(v)}>{fnum(v)}</span>
      <span className="bar"><i style={{ [v >= 0 ? 'left' : 'right']: '50%', width: `${w}%`, background: v >= 0 ? 'var(--fk-up,#12b981)' : 'var(--fk-down,#f43f5e)' } as any} /></span>
    </span>
  );
}
const Num = ({ v, d = 1 }: { v: number | null; d?: number }) => <span className={cls(v)}>{fnum(v, d)}</span>;

export default function Researcher() {
  const [group, setGroup] = useState('Сырьё');
  const [uniText, setUniText] = useState(GROUPS['Сырьё'].join(', '));
  const [horizon, setHorizon] = useState(21);
  const [years, setYears] = useState(10);
  const [blocks, setBlocks] = useState<UBlock[]>([
    { conds: [{ col: 'momentum_63', cmp: 'ge', val: 10, not: false }, { col: 'vol_21', cmp: 'le', val: 30, not: false }] },
  ]);
  // Вычисляемые метрики (формулы над факторами). Сид-пример = запрошенный кейс «среднее моментума 1/3/6м».
  const [formulas, setFormulas] = useState<FormulaDef[]>([{ id: 'f0', name: 'avgMom3', expr: 'avg(momentum_21, momentum_63, momentum_126)' }]);
  const [display, setDisplay] = useState<string[]>(['momentum_63', 'vol_21', 'rsi_14', 'avgMom3']);
  const [view, setView] = useState<'tickers' | 'years'>('tickers');
  const [panel, setPanel] = useState<ScreenPanel | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [drill, setDrill] = useState<{ kind: 't' | 'y'; kv: string } | null>(null);
  const idRef = useRef(1);
  const uid = () => `f${++idRef.current}`;

  const universe = useMemo(() => [...new Set(uniText.toUpperCase().split(/[^A-Z0-9.\-]+/).filter(Boolean))].slice(0, 40), [uniText]);
  const [applied, setApplied] = useState<{ uni: string; horizon: number } | null>(null);

  // Компиляция формул: имя → eval-функция; и ошибки по id. Имя не должно совпадать с базовым фактором,
  // ссылки внутри формулы — только на существующие факторы.
  const { fmap, ferrs } = useMemo(() => {
    const fmap: Formulas = new Map<string, CellFn>();
    const ferrs: Record<string, string> = {};
    for (const f of formulas) {
      const nm = f.name.trim();
      if (!nm) { if (f.expr.trim()) ferrs[f.id] = 'задайте имя метрики'; continue; }
      if (BASE_KEYS.has(nm)) { ferrs[f.id] = 'имя совпадает с фактором — выберите другое'; continue; }
      if (!f.expr.trim()) { ferrs[f.id] = 'пустая формула'; continue; }
      try {
        const c = compileFormula(f.expr);
        const bad = c.refs.filter((r) => !BASE_KEYS.has(r));
        if (bad.length) { ferrs[f.id] = `неизвестные факторы: ${bad.join(', ')}`; continue; }
        if (fmap.has(nm)) { ferrs[f.id] = 'дубликат имени'; continue; }
        fmap.set(nm, c.eval);
      } catch (e: any) { ferrs[f.id] = e?.message || 'ошибка формулы'; }
    }
    return { fmap, ferrs };
  }, [formulas]);

  const formulaNames = useMemo(() => [...new Set(formulas.map((f) => f.name.trim()).filter(Boolean))], [formulas]);
  const colLabel = useCallback((key: string) => {
    const b = BASE_COLS.find((c) => c.key === key);
    if (b) return b.label;
    return formulaNames.includes(key) ? `ƒ ${key}` : key;
  }, [formulaNames]);

  const fetchPanel = useCallback(async (uni: string[], hz: number): Promise<boolean> => {
    if (uni.length < 1) { setPanel(null); return false; }
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/researcher/panel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ universe: uni, horizon: hz }),
      });
      const out = await res.json().catch(() => ({}));
      if (out?.error) throw new Error(out.error);
      setPanel(out && out.mode === 'screen' ? out : null);
      return true;
    } catch (ex: any) { setErr(ex?.message || 'ошибка'); setPanel(null); return false; } finally { setLoading(false); }
  }, []);

  const apply = useCallback(async (uni: string[], hz: number) => {
    const ok = await fetchPanel(uni, hz);
    if (ok) setApplied({ uni: uni.join(','), horizon: hz });
  }, [fetchPanel]);

  useEffect(() => { apply(universe, horizon); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !applied || applied.uni !== universe.join(',') || applied.horizon !== horizon;

  const lastYear = panel ? +String(panel.meta?.last || panel.dates[panel.dates.length - 1] || '').slice(0, 4) || null : null;
  const firstYear = panel ? +String(panel.meta?.first || panel.dates[0] || '').slice(0, 4) || null : null;
  const spanYears = lastYear && firstYear ? lastYear - firstYear + 1 : null;
  const minYear = lastYear != null ? lastYear - years + 1 : undefined;

  const blk = blocks as Block[];
  const byT = useMemo(() => (panel ? screenByTicker(panel, blk, display, minYear, fmap) : []), [panel, blocks, display, minYear, fmap]); // eslint-disable-line react-hooks/exhaustive-deps
  const byY = useMemo(() => (panel ? screenByYear(panel, blk, minYear, fmap) : []), [panel, blocks, minYear, fmap]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchedN = byY.reduce((a, y) => a + y.n, 0);
  const setB = (f: (b: UBlock[]) => UBlock[]) => setBlocks((prev) => f(structuredClone(prev)));
  const tColSpan = 9 + display.length;

  const outHead = (
    <>
      <th title="Hit-rate: доля сделок с положительным форвардным возвратом">Доля +</th>
      <th title={`Средний форвардный возврат за ${horizon}д`}>Ср. return</th>
      <th title="Медианный форвардный возврат">Медиана</th>
      <th title="Средняя макс. просадка пути peak-to-trough (от локального пика; может быть глубже MAE)">Просадка</th>
      <th title="Средняя макс. неблагоприятная экскурсия от входа (MAE ≤ 0; 0, если позиция не уходила в минус)">MAE</th>
      <th title="Средняя макс. благоприятная экскурсия от входа (MFE ≥ 0; 0, если прибыли не было)">MFE</th>
      <th title="Среднее превышение бенчмарка SPY за горизонт (сырое, без винзоризации)">vs SPY</th>
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

  // <select> колонки для условия: факторы + формулы; текущее значение всегда присутствует.
  const ColSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Факторы">
        {BASE_COLS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </optgroup>
      {formulaNames.length > 0 && (
        <optgroup label="Формулы">
          {formulaNames.map((nm) => <option key={nm} value={nm}>ƒ {nm}</option>)}
        </optgroup>
      )}
      {!BASE_KEYS.has(value) && !formulaNames.includes(value) && <option value={value}>{value} (?)</option>}
    </select>
  );

  return (
    <main className="rsx" style={{ maxWidth: 1320, margin: '0 auto', padding: '20px 20px 90px' }}>
      <div className="top">
        <h1>Скринер</h1>
        <span className="badge brand">боевая версия</span>
        <span className="sub">Вселенная → условия (блоки ИЛИ, внутри И/НЕ) + формулы → метрики оценки за горизонт в окне лет → провал в сделки. Пересчёт мгновенный на клиенте.</span>
      </div>

      {/* 1. Вселенная */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="card-t">1 · Вселенная и запрос данных</span>
            <span className="sub">{universe.length} тикеров{loading ? ' · загрузка…' : dirty ? ' · изменения не применены' : ''}</span>
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
            {spanYears && <span className="sub">из {spanYears} доступных · применяется мгновенно</span>}
          </div>
          <div className="applybar">
            <button type="button" className={`btn apply${dirty ? ' on' : ''}`} disabled={loading || universe.length < 1} onClick={() => apply(universe, horizon)}>
              {loading ? 'Пересчёт…' : dirty ? 'Применить — пересчитать данные' : 'Обновить данные'}
            </button>
            <span className="sub">
              {loading ? 'запрос подготовленных данных с бэка…'
                : dirty ? 'изменены вселенная или горизонт — нажмите «Применить», чтобы пересчитать'
                : 'данные актуальны · условия, формулы, окно лет и столбцы пересчитываются на клиенте мгновенно'}
            </span>
          </div>
          {err && <p className="sub" style={{ color: 'var(--fk-down-text,#c81e3c)', fontWeight: 600, marginTop: 6 }}>Ошибка: {err}</p>}
        </div>
      </div>

      {/* 2. Условия */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="card-t">2 · Условия отбора</span>
            <span className="sub">блоки = <b style={{ color: 'var(--fk-brand-700)' }}>ИЛИ</b> · внутри блока — <b>И</b> / <b style={{ color: 'var(--fk-down-text,#c81e3c)' }}>НЕ</b> · колонка = фактор или формула</span>
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
                      <ColSelect value={c.col} onChange={(v) => setB((bb) => { bb[bi].conds[ci].col = v; return bb; })} />
                      <div className="seg">
                        {(['ge', 'le'] as Cmp[]).map((cm) => <button key={cm} className={c.cmp === cm ? 'on' : ''} onClick={() => setB((bb) => { bb[bi].conds[ci].cmp = cm; return bb; })}>{cm === 'ge' ? '≥' : '≤'}</button>)}
                      </div>
                      <input className="val" defaultValue={c.val} inputMode="decimal" onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) setB((bb) => { bb[bi].conds[ci].val = n; return bb; }); }} />
                      <span className="x" onClick={() => setB((bb) => { bb[bi].conds.splice(ci, 1); return bb; })}>✕</span>
                    </div>
                  ))}
                  <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setB((bb) => { bb[bi].conds.push({ col: 'momentum_63', cmp: 'ge', val: 10, not: false }); return bb; })}>+ И условие</button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setBlocks((p) => [...p, { conds: [{ col: 'rsi_14', cmp: 'le', val: 35, not: false }] }])}>+ ИЛИ — новый блок</button>
        </div>
      </div>

      {/* 3. Формулы */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="card-t">3 · Формулы (вычисляемые метрики)</span>
            <span className="sub">выражения над факторами: + − × ÷, скобки, avg / min / max / sum / abs</span>
          </div>
          <div className="fmls">
            {formulas.map((f) => (
              <div className="fml" key={f.id}>
                <input className="fname" placeholder="имя" value={f.name} spellCheck={false}
                  onChange={(e) => setFormulas((p) => p.map((x) => x.id === f.id ? { ...x, name: e.target.value } : x))} />
                <span className="eq">=</span>
                <input className="fexpr" placeholder="avg(momentum_21, momentum_63, momentum_126)" value={f.expr} spellCheck={false}
                  onChange={(e) => setFormulas((p) => p.map((x) => x.id === f.id ? { ...x, expr: e.target.value } : x))} />
                <span className="x" onClick={() => setFormulas((p) => p.filter((x) => x.id !== f.id))}>✕</span>
                {ferrs[f.id]
                  ? <span className="ferr">{ferrs[f.id]}</span>
                  : (f.name.trim() && fmap.has(f.name.trim()) ? <span className="fok">✓ готово</span> : null)}
              </div>
            ))}
          </div>
          <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setFormulas((p) => [...p, { id: uid(), name: '', expr: '' }])}>+ формула</button>
          <p className="sub" style={{ marginTop: 8 }}>Факторы: {BASE_COLS.map((c) => c.key).join(', ')}. Пример условия: <code>avgMom3 ≥ 10</code>.</p>
        </div>
      </div>

      {/* 4. Столбцы */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="card-t">4 · Столбцы в таблице</span><span className="sub">факторы и формулы для показа · метрики оценки показываются всегда</span>
          </div>
          <div className="dchips">
            {BASE_COLS.map((o) => {
              const on = display.includes(o.key);
              return <button key={o.key} className={`dc${on ? ' on' : ''}`} onClick={() => setDisplay((d) => on ? d.filter((x) => x !== o.key) : [...d, o.key])}>{o.label}</button>;
            })}
            {formulaNames.map((nm) => {
              const on = display.includes(nm);
              return <button key={`f_${nm}`} className={`dc fdc${on ? ' on' : ''}`} onClick={() => setDisplay((d) => on ? d.filter((x) => x !== nm) : [...d, nm])}>ƒ {nm}</button>;
            })}
          </div>
        </div>
      </div>

      {/* 5. Результаты */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span className="card-t">5 · Результаты</span>
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
                <thead><tr><th className="l">Тикер</th><th>Сделок</th>{display.map((k) => <th key={k}>{colLabel(k)}</th>)}{outHead}</tr></thead>
                <tbody>
                  {byT.map((r) => (
                    <tr key={r.symbol} className="click" onClick={() => setDrill({ kind: 't', kv: r.symbol })}>
                      <td className="l"><span className="sy">{r.symbol}</span></td><td className="num">{r.n}</td>
                      {r.disp.map((v, i) => <td key={i} className={`num ${cls(v)}`}>{v == null ? '—' : isRsiKey(display[i]) ? v.toFixed(0) : fnum(v)}</td>)}
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

      {drill && panel && <Drawer panel={panel} blocks={blk} drill={drill} horizon={panel.horizon || horizon} minYear={minYear} formulas={fmap} display={display} colLabel={colLabel} onClose={() => setDrill(null)} />}
    </main>
  );
}

function Drawer({ panel, blocks, drill, horizon, minYear, formulas, display, colLabel, onClose }: { panel: ScreenPanel; blocks: Block[]; drill: { kind: 't' | 'y'; kv: string }; horizon: number; minYear?: number; formulas: Formulas; display: string[]; colLabel: (k: string) => string; onClose: () => void }) {
  const deals = screenDeals(panel, blocks, drill.kind, drill.kv, minYear, formulas);
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
              <thead><tr><th className="l">Дата</th>{drill.kind === 'y' && <th className="l">Тикер</th>}{display.map((k) => <th key={k}>{colLabel(k)}</th>)}<th>Return</th><th>MFE</th><th>MAE</th><th>Просадка</th><th>vs SPY</th></tr></thead>
              <tbody>
                {deals.map((d, i) => (
                  <tr key={i}>
                    <td className="l num">{d.date}</td>{drill.kind === 'y' && <td className="l sy">{d.symbol}</td>}
                    {display.map((k) => { const v = d.vals[k] ?? null; return <td key={k} className={`num ${cls(v)}`}>{v == null ? '—' : isRsiKey(k) ? (v as number).toFixed(0) : fnum(v)}</td>; })}
                    <td><FwdBar v={d.ret} /></td>
                    <td className="num up">{fnum(d.mfe)}</td><td className="num down">{fnum(d.mae)}</td><td className="num down">{fnum(d.mdd)}</td>
                    <td className="num"><Num v={d.exc} /></td>
                  </tr>
                ))}
                {!deals.length && <tr><td className="l sub" colSpan={1 + (drill.kind === 'y' ? 1 : 0) + display.length + 5} style={{ padding: 16 }}>Нет сделок в окне лет.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
