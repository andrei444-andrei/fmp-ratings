'use client';

// Скринер (боевая версия). Дизайн 1:1 с утверждённым прототипом (researcher.css, токены --fk-*).
// Сервер отдаёт ПАНЕЛЬ СДЕЛОК один раз; условия/формулы/разрезы/метрики оценки/провал считаются мгновенно на клиенте.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './researcher.css';
import {
  screenByTicker, screenByYear, screenDeals, screenAllDeals, dealStats,
  type ScreenPanel, type Block, type Cmp, type Formulas, type CellFn, type Deal,
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
// Финансово-стандартные периоды факторов (синхронно с движком METR в studies.ts).
const METRICS: Record<string, { label: string; periods: number[]; unit: string }> = {
  momentum: { label: 'Моментум', periods: [5, 10, 21, 63, 126, 252], unit: '%' },
  vol: { label: 'Волатильность', periods: [10, 21, 63, 126], unit: '%' },
  dist_ath: { label: 'Расст. от макс.', periods: [0, 63, 252], unit: '%' },
  xbench: { label: 'Превышение бенч.', periods: [5, 10, 21, 63, 126, 252], unit: 'пп' },
  xvadj: { label: 'Превыш., норм. на волу', periods: [21, 63, 126, 252], unit: 'пп' },
  sma_dist: { label: 'Откл. от SMA', periods: [20, 50, 100, 200], unit: '%' },
  rsi: { label: 'RSI', periods: [7, 14, 21], unit: '' },
};
const MID = Object.keys(METRICS);
const colOf = (id: string, p: number) => `${id}_${p}`;
// Подпись периода: для dist_ath p=0 — «ATH» (исторический максимум), иначе «<p>д».
const plabel = (id: string, p: number) => (id === 'dist_ath' && p === 0 ? 'ATH' : `${p}д`);
const mlabel = (id: string, p: number) => METRICS[id].label + (METRICS[id].periods.length > 1 ? ` ${plabel(id, p) === 'ATH' ? 'ATH' : p}` : '');
// Все базовые колонки-факторы (для столбцов + валидации формул).
const BASE_COLS = MID.flatMap((id) => METRICS[id].periods.map((p) => ({ key: colOf(id, p), id, p, label: mlabel(id, p) })));
const BASE_KEYS = new Set(BASE_COLS.map((c) => c.key));
const HORIZONS = [5, 10, 21, 63];

type UCond = { col: string; cmp: Cmp; val: number; not: boolean };
type UBlock = { conds: UCond[] };
// Формула: name/expr — черновик (правится), savedName/savedExpr — применённое (по кнопке «Сохранить»).
type FormulaDef = { id: string; name: string; expr: string; savedName: string; savedExpr: string };

// Разбор ключа колонки: базовый фактор (fid+период) или имя формулы.
function parseCol(col: string): { kind: 'base'; id: string; p: number } | { kind: 'formula'; name: string } {
  const b = BASE_COLS.find((c) => c.key === col);
  return b ? { kind: 'base', id: b.id, p: b.p } : { kind: 'formula', name: col };
}
// Проверка черновика формулы → текст ошибки или null. Ссылки — только на существующие факторы.
function validateFormula(name: string, expr: string): string | null {
  const nm = name.trim();
  if (!nm && !expr.trim()) return null;
  if (!nm) return 'задайте имя метрики';
  if (BASE_KEYS.has(nm) || MID.includes(nm)) return 'имя совпадает с фактором — выберите другое';
  if (!expr.trim()) return 'пустая формула';
  try {
    const c = compileFormula(expr);
    const bad = c.refs.filter((r) => !BASE_KEYS.has(r));
    if (bad.length) return `неизвестные факторы: ${bad.join(', ')}`;
  } catch (e: any) { return e?.message || 'ошибка формулы'; }
  return null;
}

const cls = (v: number | null) => (v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const fnum = (v: number | null, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
const isRsiKey = (k: string) => k.startsWith('rsi');

// Дефолты конфигурации скринера (для старта и кнопки «Сбросить»).
const SEED_EXPR = 'avg(momentum[21], momentum[63], momentum[126])';
const DEF_UNITEXT = GROUPS['Сырьё'].join(', ');
const DEF_BLOCKS: UBlock[] = [{ conds: [{ col: 'momentum_63', cmp: 'ge', val: 10, not: false }, { col: 'vol_21', cmp: 'le', val: 30, not: false }] }];
const DEF_FORMULAS: FormulaDef[] = [{ id: 'f0', name: 'avgMom3', expr: SEED_EXPR, savedName: 'avgMom3', savedExpr: SEED_EXPR }];
const DEF_DISPLAY = ['momentum_63', 'vol_21', 'rsi_14', 'avgMom3'];
const CFG_KEY = 'rsx:cfg:v1'; // localStorage-ключ UI-настроек (БЕЗ формул — те в БД)
const parseUni = (s: string) => [...new Set(String(s).toUpperCase().split(/[^A-Z0-9.\-]+/).filter(Boolean))].slice(0, 40);
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? `f_${crypto.randomUUID()}` : `f_${Math.round(performance.now())}_${Math.floor(performance.now() % 1000)}`);

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
  const [uniText, setUniText] = useState(DEF_UNITEXT);
  const [horizon, setHorizon] = useState(21);
  const [years, setYears] = useState(10);
  const [blocks, setBlocks] = useState<UBlock[]>(structuredClone(DEF_BLOCKS));
  // Вычисляемые метрики (формулы) — постоянно в БД (см. /api/researcher/formulas). Сид-пример до загрузки из БД.
  const [formulas, setFormulas] = useState<FormulaDef[]>(structuredClone(DEF_FORMULAS));
  const [display, setDisplay] = useState<string[]>([...DEF_DISPLAY]);
  const [view, setView] = useState<'all' | 'tickers' | 'years'>('all');
  const [rf, setRf] = useState({ minN: 0, minHit: 0, minRet: -1e9 }); // realtime-фильтры результата
  const [chartCol, setChartCol] = useState<string>(''); // метрика для графика ('' = авто по первому условию)
  const [colDraft, setColDraft] = useState('vol_21'); // конструктор столбца (фактор+период) для кнопки «+»
  const [baskets, setBaskets] = useState<{ id: string; name: string; tickers: string[] }[]>([]); // сохранённые корзины (БД)
  const [saveName, setSaveName] = useState<string | null>(null); // null=скрыто; строка=поле имени корзины открыто
  const [uniChatOpen, setUniChatOpen] = useState(false); // AI-подбор тикеров
  const [panel, setPanel] = useState<ScreenPanel | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [drill, setDrill] = useState<{ kind: 't' | 'y'; kv: string } | null>(null);
  const loadedRef = useRef(false);          // настройки восстановлены (можно начинать персист)
  const [cfgNonce, setCfgNonce] = useState(0); // ремоунт uncontrolled-инпутов после восстановления/сброса

  const universe = useMemo(() => [...new Set(uniText.toUpperCase().split(/[^A-Z0-9.\-]+/).filter(Boolean))].slice(0, 40), [uniText]);
  const [applied, setApplied] = useState<{ uni: string; horizon: number } | null>(null);

  // Компиляция ПРИМЕНЁННЫХ (сохранённых) формул: имя → eval-функция. Черновики не влияют до «Сохранить».
  const { fmap, savedNames } = useMemo(() => {
    const fmap: Formulas = new Map<string, CellFn>();
    const savedNames: string[] = [];
    for (const f of formulas) {
      const sn = f.savedName.trim();
      if (!sn || !f.savedExpr.trim() || BASE_KEYS.has(sn) || MID.includes(sn) || fmap.has(sn)) continue;
      try {
        const c = compileFormula(f.savedExpr);
        if (c.refs.every((r) => BASE_KEYS.has(r))) { fmap.set(sn, c.eval); savedNames.push(sn); }
      } catch { /* невалидная сохранённая — пропускаем */ }
    }
    return { fmap, savedNames };
  }, [formulas]);

  const colLabel = useCallback((key: string) => {
    const b = BASE_COLS.find((c) => c.key === key);
    if (b) return b.label;
    return savedNames.includes(key) ? `ƒ ${key}` : key;
  }, [savedNames]);

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

  // Сохранить формулу НАВСЕГДА в БД (по кнопке), затем зафиксировать «применённый» снимок локально.
  const saveFormula = useCallback(async (f: FormulaDef) => {
    const name = f.name.trim(), expr = f.expr.trim();
    try {
      const r = await fetch('/api/researcher/formulas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: f.id, name, expr }) });
      const j = await r.json().catch(() => ({}));
      if (j?.error) throw new Error(j.error);
      setFormulas((p) => p.map((x) => (x.id === f.id ? { ...x, name, expr, savedName: name, savedExpr: expr } : x)));
    } catch (e: any) { setErr(`формула не сохранена в БД: ${e?.message || e}`); }
  }, []);
  const deleteFormula = useCallback(async (id: string) => {
    setFormulas((p) => p.filter((x) => x.id !== id));
    try { await fetch(`/api/researcher/formulas?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* удалится из БД позже/вручную */ }
  }, []);

  // Корзины тикеров (БД, навсегда).
  const saveBasket = useCallback(async (name: string, tickers: string[]) => {
    const nm = name.trim(); if (!nm || !tickers.length) return;
    const id = newId();
    setBaskets((p) => [...p.filter((x) => x.name !== nm), { id, name: nm, tickers }]);
    setSaveName(null);
    try {
      const r = await fetch('/api/researcher/baskets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: nm, tickers }) });
      const j = await r.json().catch(() => ({})); if (j?.error) throw new Error(j.error);
    } catch (e: any) { setErr(`корзина не сохранена в БД: ${e?.message || e}`); }
  }, []);
  const removeBasket = useCallback(async (id: string) => {
    setBaskets((p) => p.filter((x) => x.id !== id));
    try { await fetch(`/api/researcher/baskets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* */ }
  }, []);

  // Восстановление настроек (UI — из localStorage; формулы — из БД, навсегда) + первичная загрузка панели. Один раз.
  useEffect(() => {
    let cfg: any = null;
    try { const raw = localStorage.getItem(CFG_KEY); if (raw) cfg = JSON.parse(raw); } catch { /* нет/битый */ }
    if (cfg && typeof cfg === 'object') {
      if (typeof cfg.uniText === 'string') setUniText(cfg.uniText);
      if (typeof cfg.group === 'string') setGroup(cfg.group);
      if (typeof cfg.horizon === 'number') setHorizon(cfg.horizon);
      if (typeof cfg.years === 'number') setYears(cfg.years);
      if (Array.isArray(cfg.blocks)) setBlocks(cfg.blocks);
      if (Array.isArray(cfg.display)) setDisplay(cfg.display);
      if (cfg.view === 'all' || cfg.view === 'tickers' || cfg.view === 'years') setView(cfg.view);
    }
    (async () => {
      try {
        const r = await fetch('/api/researcher/formulas');
        const j = await r.json().catch(() => ({}));
        if (Array.isArray(j?.formulas) && j.formulas.length) {
          setFormulas(j.formulas.map((f: any) => ({ id: String(f.id), name: String(f.name), expr: String(f.expr), savedName: String(f.name), savedExpr: String(f.expr) })));
        } else {
          // БД пуста → сохраняем сид-формулу навсегда (чтобы avgMom3 работала из коробки).
          fetch('/api/researcher/formulas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: DEF_FORMULAS[0].id, name: DEF_FORMULAS[0].name, expr: DEF_FORMULAS[0].expr }) }).catch(() => {});
        }
      } catch { /* БД недоступна → остаётся сид-формула */ }
      try {
        const r = await fetch('/api/researcher/baskets');
        const j = await r.json().catch(() => ({}));
        if (Array.isArray(j?.baskets)) setBaskets(j.baskets.map((b: any) => ({ id: String(b.id), name: String(b.name), tickers: Array.isArray(b.tickers) ? b.tickers : [] })));
      } catch { /* нет БД — без сохранённых корзин */ }
    })();
    loadedRef.current = true;
    setCfgNonce((n) => n + 1);
    apply(parseUni(cfg?.uniText ?? DEF_UNITEXT), typeof cfg?.horizon === 'number' ? cfg.horizon : 21);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Персист UI-настроек в localStorage (формулы НЕ здесь — они в БД).
  useEffect(() => {
    if (!loadedRef.current) return;
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ uniText, group, horizon, years, blocks, display, view })); } catch { /* квота/приватный режим */ }
  }, [uniText, group, horizon, years, blocks, display, view]);

  // Сброс UI-настроек к дефолтам (формулы в БД не трогаем — они постоянные).
  const resetAll = () => {
    try { localStorage.removeItem(CFG_KEY); } catch { /* */ }
    setGroup('Сырьё'); setUniText(DEF_UNITEXT); setHorizon(21); setYears(10);
    setBlocks(structuredClone(DEF_BLOCKS)); setDisplay([...DEF_DISPLAY]); setView('all');
    setRf({ minN: 0, minHit: 0, minRet: -1e9 }); setCfgNonce((n) => n + 1);
    apply(parseUni(DEF_UNITEXT), 21);
  };

  const dirty = !applied || applied.uni !== universe.join(',') || applied.horizon !== horizon;

  const lastYear = panel ? +String(panel.meta?.last || panel.dates[panel.dates.length - 1] || '').slice(0, 4) || null : null;
  const firstYear = panel ? +String(panel.meta?.first || panel.dates[0] || '').slice(0, 4) || null : null;
  const spanYears = lastYear && firstYear ? lastYear - firstYear + 1 : null;
  const minYear = lastYear != null ? lastYear - years + 1 : undefined;

  const blk = blocks as Block[];
  // Каноническая последовательность столбцов: факторы по типу (моментум → вола → … ) с возрастающим
  // периодом (порядок BASE_COLS), формулы — в конце. Чтобы столбцы шли логично, а не в порядке клика.
  const colRank = (k: string) => { const i = BASE_COLS.findIndex((c) => c.key === k); return i >= 0 ? i : 1000 + Math.max(0, savedNames.indexOf(k)); };
  const displayCols = useMemo(() => [...display].sort((a, b) => colRank(a) - colRank(b)), [display, savedNames]); // eslint-disable-line react-hooks/exhaustive-deps
  const byTraw = useMemo(() => (panel ? screenByTicker(panel, blk, displayCols, minYear, fmap) : []), [panel, blocks, displayCols, minYear, fmap]); // eslint-disable-line react-hooks/exhaustive-deps
  const byYraw = useMemo(() => (panel ? screenByYear(panel, blk, minYear, fmap) : []), [panel, blocks, minYear, fmap]); // eslint-disable-line react-hooks/exhaustive-deps
  const allDeals = useMemo(() => (panel ? screenAllDeals(panel, blk, minYear, fmap) : []), [panel, blocks, minYear, fmap]); // eslint-disable-line react-hooks/exhaustive-deps
  const consol = useMemo(() => dealStats(allDeals), [allDeals]);
  // realtime-фильтры результата (мгновенно, поверх агрегатов строк)
  const passRf = (r: { n: number; hitPct: number; avgRet: number }) => r.n >= rf.minN && r.hitPct >= rf.minHit && r.avgRet >= rf.minRet;
  const byT = byTraw.filter(passRf);
  const byY = byYraw.filter(passRf);
  const matchedN = consol.n;
  const setB = (f: (b: UBlock[]) => UBlock[]) => setBlocks((prev) => f(structuredClone(prev)));
  const tColSpan = 10 + display.length;
  // Метрика для графика: выбранная (если валидна) → первое условие → первый столбец.
  const condCols = [...new Set(blk.flatMap((b) => b.conds.map((c) => c.col)))];
  const chartOpts = [...new Set([...condCols, ...display])];
  const chartMetric = (chartCol && chartOpts.includes(chartCol)) ? chartCol : (condCols[0] || display[0] || 'momentum_63');
  const chartThresholds = blk.flatMap((b) => b.conds).filter((c) => c.col === chartMetric).map((c) => ({ cmp: c.cmp, val: c.val }));

  const outHead = (
    <>
      <th title="Hit-rate: доля сделок с положительным форвардным возвратом">Доля +</th>
      <th title={`Средний форвардный возврат за ${horizon}д`}>Ср. return</th>
      <th title="Медианный форвардный возврат">Медиана</th>
      <th title="Средняя макс. просадка пути peak-to-trough (от локального пика; может быть глубже MAE)">Просадка</th>
      <th title="Средняя макс. неблагоприятная экскурсия от входа (MAE ≤ 0; 0, если позиция не уходила в минус)">MAE</th>
      <th title="Средняя макс. благоприятная экскурсия от входа (MFE ≥ 0; 0, если прибыли не было)">MFE</th>
      <th title="Среднее превышение бенчмарка SPY за горизонт (сырое, без винзоризации)">vs SPY</th>
      <th title="t-статистика среднего форвардного возврата (|t|≥2 ≈ значимо). Грубо: наблюдения сэмплированы шагом H, межтикерная корреляция не учтена">t-стат</th>
    </>
  );
  const outCells = (s: { hitPct: number; avgRet: number; medRet: number; avgMdd: number; avgMae: number; avgMfe: number; avgExc: number; tstat: number }) => (
    <>
      <td className="num">{s.hitPct.toFixed(0)}%</td>
      <td className="num"><Num v={s.avgRet} /></td>
      <td className="num"><Num v={s.medRet} /></td>
      <td className="num down">{fnum(s.avgMdd)}</td>
      <td className="num down">{fnum(s.avgMae)}</td>
      <td className="num up">{fnum(s.avgMfe)}</td>
      <td><FwdBar v={s.avgExc} /></td>
      <td className="num" style={{ fontWeight: Math.abs(s.tstat) >= 2 ? 700 : 400, color: Math.abs(s.tstat) >= 2 ? 'var(--fk-text)' : 'var(--fk-text-3)' }}>{s.tstat.toFixed(2)}</td>
    </>
  );

  // Колонка условия = два контрола: тип фактора (или формула) + параметр-период. Период скрыт для формул.
  const CondCol = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
    const cur = parseCol(value);
    const ftVal = cur.kind === 'base' ? cur.id : `f:${cur.name}`;
    const onFactor = (v: string) => {
      if (v.startsWith('f:')) { onChange(v.slice(2)); return; }
      const periods = METRICS[v].periods;
      const p = cur.kind === 'base' && periods.includes(cur.p) ? cur.p : periods[0];
      onChange(colOf(v, p));
    };
    return (
      <>
        <select value={ftVal} onChange={(e) => onFactor(e.target.value)}>
          <optgroup label="Факторы">{MID.map((id) => <option key={id} value={id}>{METRICS[id].label}</option>)}</optgroup>
          {savedNames.length > 0 && <optgroup label="Формулы">{savedNames.map((nm) => <option key={nm} value={`f:${nm}`}>ƒ {nm}</option>)}</optgroup>}
          {cur.kind === 'formula' && !savedNames.includes(cur.name) && <option value={`f:${cur.name}`}>{cur.name} (?)</option>}
        </select>
        <select value={cur.kind === 'base' ? cur.p : ''} disabled={cur.kind !== 'base' || METRICS[cur.id].periods.length < 2}
          onChange={(e) => cur.kind === 'base' && onChange(colOf(cur.id, +e.target.value))}>
          {cur.kind === 'base'
            ? METRICS[cur.id].periods.map((p) => <option key={p} value={p}>{plabel(cur.id, p)}</option>)
            : <option value="">—</option>}
        </select>
      </>
    );
  };

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
            {baskets.map((b) => (
              <button key={b.id} type="button" className={`chip bskt${group === b.name ? ' on' : ''}`} title={b.tickers.join(', ')} onClick={() => { setGroup(b.name); setUniText(b.tickers.join(', ')); }}>
                {b.name}<span className="n">{b.tickers.length}</span>
                <span className="bx" onClick={(e) => { e.stopPropagation(); removeBasket(b.id); }} title="удалить корзину">✕</span>
              </button>
            ))}
          </div>
          <textarea className="uni" value={uniText} spellCheck={false} onChange={(e) => { setUniText(e.target.value); setGroup(''); }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className={`btn sm ghost${uniChatOpen ? ' on' : ''}`} onClick={() => setUniChatOpen((o) => !o)}>✨ AI-подбор тикеров</button>
            {saveName === null
              ? <button type="button" className="btn sm ghost" disabled={universe.length < 1} onClick={() => setSaveName(group && !GROUPS[group] ? group : '')}>💾 Сохранить как корзину</button>
              : (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input className="rfin" style={{ width: 160, textAlign: 'left' }} autoFocus placeholder="имя корзины" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveBasket(saveName, universe); }} />
                  <button type="button" className="btn sm" disabled={!saveName.trim() || universe.length < 1} onClick={() => saveBasket(saveName, universe)}>Сохранить</button>
                  <button type="button" className="btn sm ghost" onClick={() => setSaveName(null)}>отмена</button>
                </span>
              )}
          </div>
          {uniChatOpen && <UniverseChat onApply={(ts, replace) => { const cur = replace ? [] : universe; const merged = [...new Set([...cur, ...ts.map((t) => t.toUpperCase())])].slice(0, 40); setUniText(merged.join(', ')); setGroup(''); }} onClose={() => setUniChatOpen(false)} />}
          <p className="sub" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Пресет/корзина — стартовый набор; список правится свободно (до 40).</span>
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
            <button type="button" className="btn ghost sm" onClick={resetAll}>Сбросить к дефолтам</button>
            <span className="sub">
              {loading ? 'запрос подготовленных данных с бэка…'
                : dirty ? 'изменены вселенная или горизонт — нажмите «Применить», чтобы пересчитать'
                : 'настройка сохраняется в браузере, формулы — в БД · условия/окно лет/столбцы считаются мгновенно'}
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
                      <CondCol value={c.col} onChange={(v) => setB((bb) => { bb[bi].conds[ci].col = v; return bb; })} />
                      <div className="seg">
                        {(['ge', 'le'] as Cmp[]).map((cm) => <button key={cm} className={c.cmp === cm ? 'on' : ''} onClick={() => setB((bb) => { bb[bi].conds[ci].cmp = cm; return bb; })}>{cm === 'ge' ? '≥' : '≤'}</button>)}
                      </div>
                      <input className="val" key={`v-${cfgNonce}`} defaultValue={c.val} inputMode="decimal" onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) setB((bb) => { bb[bi].conds[ci].val = n; return bb; }); }} />
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
            {formulas.map((f) => {
              const err = validateFormula(f.name, f.expr);
              const dirty = f.name !== f.savedName || f.expr !== f.savedExpr;
              const canSave = dirty && err == null && !!f.name.trim() && !!f.expr.trim();
              return (
                <div className="fml" key={f.id}>
                  <input className="fname" placeholder="имя" value={f.name} spellCheck={false}
                    onChange={(e) => setFormulas((p) => p.map((x) => x.id === f.id ? { ...x, name: e.target.value } : x))} />
                  <span className="eq">=</span>
                  <input className="fexpr" placeholder="avg(momentum[21], momentum[63], momentum[126])" value={f.expr} spellCheck={false}
                    onChange={(e) => setFormulas((p) => p.map((x) => x.id === f.id ? { ...x, expr: e.target.value } : x))} />
                  <button className="btn sm" disabled={!canSave} onClick={() => saveFormula(f)}>Сохранить</button>
                  <span className="x" onClick={() => deleteFormula(f.id)}>✕</span>
                  {err ? <span className="ferr">{err}</span>
                    : dirty ? <span className="fwarn">● не сохранено — нажмите «Сохранить»</span>
                    : <span className="fok">✓ применена</span>}
                </div>
              );
            })}
          </div>
          <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setFormulas((p) => [...p, { id: newId(), name: '', expr: '', savedName: '', savedExpr: '' }])}>+ формула</button>
          <p className="sub" style={{ marginTop: 8 }}>Сохранённые формулы хранятся в БД (навсегда). Ссылки на факторы — <code>momentum[252]</code>, <code>vol[63]</code>, <code>xbench[21]</code>, <code>rsi[14]</code>, <code>sma_dist[200]</code>, <code>dist_ath[0]</code>. Пример: <code>avg(momentum[21], momentum[63], momentum[126])</code> → условие <code>avgMom3 ≥ 10</code>.</p>
        </div>
      </div>

      {/* 4. Столбцы */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="card-t">4 · Столбцы в таблице</span><span className="sub">выберите функцию и параметр, нажмите «+» · метрики оценки показываются всегда</span>
          </div>
          {/* выбранные столбцы — удаляемые чипы (в каноническом порядке) */}
          <div className="dchips">
            {displayCols.length
              ? displayCols.map((k) => <button key={k} className={`dc on${savedNames.includes(k) ? ' fdc' : ''}`} onClick={() => setDisplay((d) => d.filter((x) => x !== k))} title="убрать столбец">{colLabel(k)} ✕</button>)
              : <span className="sub">столбцов нет — добавьте ниже</span>}
          </div>
          {/* добавление столбца: функция + параметр + «+» */}
          <div className="addcol">
            <span className="lbl">Добавить столбец:</span>
            <CondCol value={colDraft} onChange={setColDraft} />
            <button type="button" className="btn sm" disabled={display.includes(colDraft)} onClick={() => setDisplay((d) => d.includes(colDraft) ? d : [...d, colDraft])}>+ добавить</button>
            {display.includes(colDraft) && <span className="sub">уже добавлен</span>}
          </div>
        </div>
      </div>

      {/* 5. Результаты */}
      <div className="card">
        <div className="card-b">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="card-t">5 · Результаты</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="sub">{!panel ? '' : view === 'all' ? `${consol.n} сделок · ${consol.tickers} тикеров`
                : view === 'tickers' ? `${matchedN} сделок · ${byT.length}${byT.length !== byTraw.length ? `/${byTraw.length}` : ''} тикеров`
                : `${matchedN} сделок · ${byY.length}${byY.length !== byYraw.length ? `/${byYraw.length}` : ''} лет`}</span>
              <div className="seg" style={{ width: 'auto' }}>
                {(['all', 'tickers', 'years'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} style={{ padding: '4px 10px' }}>{v === 'all' ? 'Сводно' : v === 'tickers' ? 'По тикерам' : 'По годам'}</button>)}
              </div>
            </div>
          </div>

          {/* realtime-фильтры строк результата (тикеры/годы) */}
          {panel && view !== 'all' && (
            <div className="rfbar">
              <span className="lbl">Фильтр строк:</span>
              <label>сделок ≥ <input className="rfin" type="number" min={0} value={rf.minN} onChange={(e) => setRf((s) => ({ ...s, minN: Math.max(0, Math.floor(+e.target.value || 0)) }))} /></label>
              <label>доля + ≥ <input className="rfin" type="number" min={0} max={100} value={rf.minHit} onChange={(e) => setRf((s) => ({ ...s, minHit: +e.target.value || 0 }))} />%</label>
              <label>ср.return ≥ <input className="rfin" type="number" value={rf.minRet <= -1e8 ? '' : rf.minRet} placeholder="—" onChange={(e) => setRf((s) => ({ ...s, minRet: e.target.value === '' ? -1e9 : (+e.target.value || 0) }))} /></label>
              {(rf.minN || rf.minHit || rf.minRet > -1e8) ? <button className="btn sm ghost" onClick={() => setRf({ minN: 0, minHit: 0, minRet: -1e9 })}>сброс</button> : null}
            </div>
          )}

          {!panel ? (
            <p className="sub" style={{ textAlign: 'center', padding: '36px 0' }}>{loading ? 'Загружаю панель сделок…' : 'Выберите вселенную.'}</p>
          ) : view === 'all' ? (
            <div>
              <div className="statgrid cons">
                {([['Сделок', String(consol.n), ''], ['Тикеров', String(consol.tickers), ''], ['Доля +', consol.hitPct.toFixed(0) + '%', ''], ['Ср. return', fnum(consol.avgRet) + '%', cls(consol.avgRet)],
                  ['Медиана', fnum(consol.medRet) + '%', cls(consol.medRet)], ['Просадка', fnum(consol.avgMdd) + '%', 'down'], ['MAE', fnum(consol.avgMae) + '%', 'down'], ['MFE', fnum(consol.avgMfe) + '%', 'up'],
                  ['vs SPY', fnum(consol.avgExc) + '%', cls(consol.avgExc)],
                  ['t-стат', consol.tstat.toFixed(2), Math.abs(consol.tstat) >= 2 ? 'up' : ''], ['p-value', consol.pval.toFixed(3), consol.pval <= 0.05 ? 'up' : ''],
                  ['Период', allDeals.length ? `${allDeals[0].date} … ${allDeals[allDeals.length - 1].date}` : '—', '']] as [string, string, string][]).map(([k, v, t]) => (
                  <div className="stat" key={k}><div className="k">{k}</div><div className={`v ${t}`}>{v}</div></div>
                ))}
              </div>
              <div className="chart-head">
                <span className="card-t">График сделок</span>
                <label className="sub">метрика по Y: <select value={chartMetric} onChange={(e) => setChartCol(e.target.value)}>{chartOpts.map((k) => <option key={k} value={k}>{colLabel(k)}</option>)}</select></label>
              </div>
              <DealChart deals={allDeals} metric={chartMetric} label={colLabel(chartMetric)} thresholds={chartThresholds} />
              <p className="sub" style={{ marginTop: 6 }}>Точка = сделка: X — дата входа (периоды сделок), Y — «{colLabel(chartMetric)}»; <span className="up">зелёная</span>/<span className="down">красная</span> — знак форварда; пунктир — порог условия.</p>
            </div>
          ) : view === 'tickers' ? (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th className="l">Тикер</th><th>Сделок</th>{displayCols.map((k) => <th key={k}>{colLabel(k)}</th>)}{outHead}</tr></thead>
                <tbody>
                  {byT.map((r) => (
                    <tr key={r.symbol} className="click" onClick={() => setDrill({ kind: 't', kv: r.symbol })}>
                      <td className="l"><span className="sy">{r.symbol}</span></td><td className="num">{r.n}</td>
                      {r.disp.map((v, i) => <td key={i} className={`num ${cls(v)}`}>{v == null ? '—' : isRsiKey(displayCols[i]) ? v.toFixed(0) : fnum(v)}</td>)}
                      {outCells(r)}
                    </tr>
                  ))}
                  {!byT.length && <tr><td className="l sub" colSpan={tColSpan} style={{ padding: 20 }}>{byTraw.length ? 'Все строки отсеяны фильтром — ослабьте фильтр строк.' : 'Ничего не прошло условия — ослабьте блоки или расширьте окно лет.'}</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th className="l">Год</th><th>Сделок</th><th>Тикеров</th>{outHead}</tr></thead>
                <tbody>
                  {byY.map((y) => (
                    <tr key={y.year} className="click" onClick={() => setDrill({ kind: 'y', kv: String(y.year) })}>
                      <td className="l"><span className="sy">{y.year}</span></td><td className="num">{y.n}</td><td className="num">{y.tickers}</td>
                      {outCells(y)}
                    </tr>
                  ))}
                  {!byY.length && <tr><td className="l sub" colSpan={11} style={{ padding: 20 }}>{byYraw.length ? 'Все строки отсеяны фильтром.' : 'Нет сделок в окне лет.'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {panel && <p className="foot">Клик по строке → провал внутрь сделок. Панель: {panel.meta?.obs} сделок, {panel.symbols.length} тикеров, {panel.meta?.first} … {panel.meta?.last} · форвард {panel.horizon}д · окно {years} лет{minYear ? ` (с ${minYear})` : ''}.</p>}
        </div>
      </div>

      {drill && panel && <Drawer panel={panel} blocks={blk} drill={drill} horizon={panel.horizon || horizon} minYear={minYear} formulas={fmap} display={displayCols} colLabel={colLabel} onClose={() => setDrill(null)} />}

      <FormulaChat
        factors={MID.map((id) => ({ id, label: METRICS[id].label, periods: METRICS[id].periods }))}
        onInsert={(name, expr) => { setFormulas((p) => [...p, { id: newId(), name, expr, savedName: '', savedExpr: '' }]); }}
      />
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
    ['t-стат', st.tstat.toFixed(2), Math.abs(st.tstat) >= 2 ? 'up' : ''],
    ['p-value', st.pval.toFixed(3), st.pval <= 0.05 ? 'up' : ''],
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

// График сделок: scatter (X — дата входа, Y — значение метрики отбора), цвет — знак форварда,
// пунктир — пороги условий по этой метрике. Чистый SVG, без зависимостей.
function DealChart({ deals, metric, label, thresholds }: { deals: Deal[]; metric: string; label: string; thresholds: { cmp: 'ge' | 'le'; val: number }[] }) {
  const pts = deals
    .map((d) => ({ t: Date.parse(d.date + 'T00:00:00Z'), y: d.vals[metric] as number | null, ret: d.ret }))
    .filter((p) => Number.isFinite(p.t) && p.y != null && Number.isFinite(p.y)) as { t: number; y: number; ret: number }[];
  if (pts.length < 2) return <p className="sub" style={{ padding: '20px 0' }}>Недостаточно сделок с метрикой «{label}» для графика.</p>;
  const W = 920, H = 300, mL = 48, mR = 16, mT = 14, mB = 26;
  const iw = W - mL - mR, ih = H - mT - mB;
  const ts = pts.map((p) => p.t), ys = pts.map((p) => p.y);
  const thr = thresholds.map((t) => t.val);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  let ymin = Math.min(...ys, ...thr), ymax = Math.max(...ys, ...thr);
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const padY = (ymax - ymin) * 0.08; ymin -= padY; ymax += padY;
  const X = (t: number) => mL + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
  const Y = (v: number) => mT + ((ymax - v) / (ymax - ymin)) * ih;
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  const years: number[] = []; for (let yy = y0; yy <= y1; yy++) years.push(yy);
  const step = Math.ceil(years.length / 12);
  const yticks = [ymin, (ymin + ymax) / 2, ymax];
  const line = 'var(--fk-line)', line2 = 'var(--fk-line-strong)', t3 = 'var(--fk-text-3)', brand = 'var(--fk-brand-700,#2563eb)';
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {yticks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={mL} x2={W - mR} y1={Y(v)} y2={Y(v)} style={{ stroke: line }} />
            <text x={mL - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" style={{ fill: t3 }}>{v.toFixed(1)}</text>
          </g>
        ))}
        {ymin < 0 && ymax > 0 && <line x1={mL} x2={W - mR} y1={Y(0)} y2={Y(0)} style={{ stroke: line2 }} />}
        {thresholds.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={mL} x2={W - mR} y1={Y(t.val)} y2={Y(t.val)} style={{ stroke: brand }} strokeDasharray="5 4" />
            <text x={W - mR} y={Y(t.val) - 3} textAnchor="end" fontSize="10" style={{ fill: brand }}>{(t.cmp === 'ge' ? '≥ ' : '≤ ') + t.val}</text>
          </g>
        ))}
        {years.filter((yy) => (yy - y0) % step === 0).map((yy) => (
          <text key={`x${yy}`} x={X(Date.parse(`${yy}-01-01T00:00:00Z`))} y={H - 8} textAnchor="middle" fontSize="10" style={{ fill: t3 }}>{yy}</text>
        ))}
        {pts.map((p, i) => (
          <circle key={i} cx={X(p.t)} cy={Y(p.y)} r={2.6} style={{ fill: p.ret > 0 ? 'var(--fk-up,#12b981)' : 'var(--fk-down,#f43f5e)', fillOpacity: 0.72 }} />
        ))}
      </svg>
    </div>
  );
}

type ChatMsg = { role: 'user' | 'assistant'; content: string; formula?: { name: string; expr: string } | null };

// Всплывающий AI-чат: помогает составить формулу из словесного описания, предлагает готовое выражение
// (валидируется на клиенте) с кнопкой «Вставить в формулы».
function FormulaChat({ factors, onInsert }: { factors: { id: string; label: string; periods: number[] }[]; onInsert: (name: string, expr: string) => void }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    { role: 'assistant', content: 'Опишите метрику словами — соберу формулу. Например: «моментум за 3 месяца, делённый на волатильность 63д» или «превышение бенча, скорр. на волу, минус половина просадки».' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [msgs, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr(''); setInput('');
    const next: ChatMsg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next); setBusy(true);
    try {
      const res = await fetch('/api/researcher/formula-assistant', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ factors, messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (j?.error) throw new Error(j.error);
      const formula = j?.formula && j.formula.name && j.formula.expr ? { name: String(j.formula.name), expr: String(j.formula.expr) } : null;
      setMsgs((m) => [...m, { role: 'assistant', content: String(j?.reply || '…'), formula }]);
    } catch (e: any) { setErr(e?.message || 'ошибка AI'); } finally { setBusy(false); }
  };

  return (
    <div className="rsx">
      <button type="button" className="rsx-chat-fab" onClick={() => setOpen((o) => !o)}>✨ AI-формулы</button>
      {open && (
        <div className="rsx-chat">
          <div className="hd"><b>AI-помощник по формулам</b><span className="x" onClick={() => setOpen(false)}>✕</span></div>
          <div className="msgs" ref={boxRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="bub">{m.content}</div>
                {m.formula && <FormulaSuggestion f={m.formula} onInsert={onInsert} />}
              </div>
            ))}
            {busy && <div className="msg assistant"><div className="bub">…думаю</div></div>}
            {err && <div className="msg assistant"><div className="bub err">{err}</div></div>}
          </div>
          <div className="inp">
            <textarea value={input} placeholder="Опишите метрику…" spellCheck={false}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button type="button" className="btn apply on" disabled={busy || !input.trim()} onClick={send}>→</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Карточка предложенной формулы с валидацией (компиляция + ссылки на факторы) и кнопкой вставки.
function FormulaSuggestion({ f, onInsert }: { f: { name: string; expr: string }; onInsert: (n: string, e: string) => void }) {
  const [added, setAdded] = useState(false);
  const err = useMemo(() => {
    if (BASE_KEYS.has(f.name) || MID.includes(f.name)) return 'имя совпадает с фактором';
    try { const c = compileFormula(f.expr); const bad = c.refs.filter((r) => !BASE_KEYS.has(r)); return bad.length ? `неизвестные факторы: ${bad.join(', ')}` : null; }
    catch (e: any) { return e?.message || 'ошибка формулы'; }
  }, [f]);
  return (
    <div className="fcard">
      <div className="fc-name">ƒ {f.name}</div>
      <code>{f.expr}</code>
      {err ? <div className="ferr">{err}</div>
        : added ? <div className="fok">✓ добавлено в «Формулы» — проверьте и нажмите «Сохранить»</div>
        : <button type="button" className="btn sm" onClick={() => { onInsert(f.name, f.expr); setAdded(true); }}>Вставить в формулы</button>}
    </div>
  );
}

type UMsg = { role: 'user' | 'assistant'; content: string; tickers?: string[] };

// Встроенный AI-чат подбора вселенной: диалог по теме/критериям → список тикеров, который можно
// добавить в вселенную или заменить ею.
function UniverseChat({ onApply, onClose }: { onApply: (tickers: string[], replace: boolean) => void; onClose: () => void }) {
  const [msgs, setMsgs] = useState<UMsg[]>([
    { role: 'assistant', content: 'Опишите тему/критерии — подберу тикеры. Например: «ликвидные ETF на полупроводники», «крупные дивидендные акции США», «защита от инфляции», «сектора, растущие при сильном долларе».' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [msgs, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr(''); setInput('');
    const next: UMsg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next); setBusy(true);
    try {
      const res = await fetch('/api/researcher/universe-assistant', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (j?.error) throw new Error(j.error);
      const tickers = Array.isArray(j?.tickers) ? j.tickers.map((t: any) => String(t).toUpperCase()) : [];
      setMsgs((m) => [...m, { role: 'assistant', content: String(j?.reply || '…'), tickers: tickers.length ? tickers : undefined }]);
    } catch (e: any) { setErr(e?.message || 'ошибка AI'); } finally { setBusy(false); }
  };

  return (
    <div className="rsx-chat inline">
      <div className="hd"><b>AI-подбор тикеров</b><span className="x" onClick={onClose}>✕</span></div>
      <div className="msgs" ref={boxRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bub">{m.content}</div>
            {m.tickers && m.tickers.length > 0 && <TickerPick tickers={m.tickers} onApply={onApply} />}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="bub">…подбираю</div></div>}
        {err && <div className="msg assistant"><div className="bub err">{err}</div></div>}
      </div>
      <div className="inp">
        <textarea value={input} placeholder="Опишите тему/критерии…" spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="button" className="btn apply on" disabled={busy || !input.trim()} onClick={send}>→</button>
      </div>
    </div>
  );
}

// Предложенные тикеры: выбираешь нужные → добавить в вселенную или заменить ею.
function TickerPick({ tickers, onApply }: { tickers: string[]; onApply: (t: string[], replace: boolean) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(tickers));
  const [done, setDone] = useState('');
  const arr = [...sel];
  return (
    <div className="fcard">
      <div className="tk-chips">
        {tickers.map((t) => (
          <button key={t} type="button" className={`tk${sel.has(t) ? ' on' : ''}`} onClick={() => setSel((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })}>{t}</button>
        ))}
      </div>
      {done ? <div className="fok">✓ {done}</div> : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" disabled={!arr.length} onClick={() => { onApply(arr, false); setDone(`добавлено ${arr.length} в вселенную`); }}>Добавить выбранные</button>
          <button type="button" className="btn sm ghost" disabled={!arr.length} onClick={() => { onApply(arr, true); setDone(`вселенная заменена (${arr.length})`); }}>Заменить вселенную</button>
        </div>
      )}
    </div>
  );
}
