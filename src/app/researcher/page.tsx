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
// Пресет настроек скринера: условия + столбцы + горизонт/окно/вид (config), с именем и описанием.
type PresetCfg = { blocks?: UBlock[]; display?: string[]; horizon?: number; years?: number; view?: 'all' | 'tickers' | 'years' };
type PresetDef = { id: string; name: string; description: string; config: PresetCfg };
// Сетап — сохранённая находка скринера как сущность: рецепт (вселенная+условия+горизонт+окно), снимок цифр,
// поток сделок (в БД, не в UI). Кирпичик для будущего раздела «Стратегии».
type SetupCfg = { uniText?: string; group?: string; blocks?: UBlock[]; display?: string[]; horizon?: number; years?: number; view?: 'all' | 'tickers' | 'years' };
type SetupDef = { id: string; name: string; description: string; config: SetupCfg; snapshot: Record<string, number | string> };

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
const r2 = (x: number) => Math.round(x * 100) / 100; // компактные числа в потоке/снимке сетапа
// Подпись «рецепта» сетапа (вселенная+условия+горизонт+окно) — для определения активного сетапа.
const recipeSig = (uni: string[], blocks: unknown, horizon?: number, years?: number) => JSON.stringify({ u: uni.join(','), b: blocks ?? [], h: horizon, y: years });
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
  const [basketModal, setBasketModal] = useState(false); // модалка «Создать корзину» (ручной ввод + AI)
  const [formulaHelp, setFormulaHelp] = useState(false); // модалка-справка «как составлять формулы»
  const [presets, setPresets] = useState<PresetDef[]>([]); // пресеты настроек скринера (БД, навсегда)
  const [presetSave, setPresetSave] = useState<{ name: string; description: string } | null>(null); // форма сохранения пресета
  const [setups, setSetups] = useState<SetupDef[]>([]); // сохранённые сетапы-находки (БД, навсегда)
  const [setupSave, setSetupSave] = useState<{ name: string; description: string } | null>(null); // форма сохранения сетапа
  const [priceSeries, setPriceSeries] = useState<Record<string, { date: string; close: number }[]>>({}); // дневные цены для графиков сделок
  const [pricesLoading, setPricesLoading] = useState(false);
  const [detailSym, setDetailSym] = useState<string | null>(null); // открытый детальный график актива (зум + метрики периода)

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
    const id = baskets.find((x) => x.name === nm)?.id ?? newId(); // то же имя → перезапись (тот же id), без дублей в БД
    setBaskets((p) => [...p.filter((x) => x.name !== nm), { id, name: nm, tickers }]);
    setSaveName(null); setBasketModal(false);
    try {
      const r = await fetch('/api/researcher/baskets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: nm, tickers }) });
      const j = await r.json().catch(() => ({})); if (j?.error) throw new Error(j.error);
    } catch (e: any) { setErr(`корзина не сохранена в БД: ${e?.message || e}`); }
  }, [baskets]);
  const removeBasket = useCallback(async (id: string) => {
    setBaskets((p) => p.filter((x) => x.id !== id));
    try { await fetch(`/api/researcher/baskets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* */ }
  }, []);

  // Пресеты настроек скринера (условия + столбцы + горизонт/окно/вид) — БД, навсегда.
  const savePreset = useCallback(async (name: string, description: string) => {
    const nm = name.trim(); if (!nm) return;
    const id = presets.find((x) => x.name === nm)?.id ?? newId(); // то же имя → перезапись (тот же id)
    const config: PresetCfg = { blocks, display, horizon, years, view };
    const desc = description.trim();
    setPresets((p) => [...p.filter((x) => x.name !== nm), { id, name: nm, description: desc, config }]);
    setPresetSave(null);
    try {
      const r = await fetch('/api/researcher/presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: nm, description: desc, config }) });
      const j = await r.json().catch(() => ({})); if (j?.error) throw new Error(j.error);
    } catch (e: any) { setErr(`пресет не сохранён в БД: ${e?.message || e}`); }
  }, [presets, blocks, display, horizon, years, view]);
  const removePreset = useCallback(async (id: string) => {
    setPresets((p) => p.filter((x) => x.id !== id));
    try { await fetch(`/api/researcher/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* */ }
  }, []);
  // Загрузка пресета: восстанавливаем условия/столбцы/горизонт/окно/вид. Горизонт меняет панель → станет «применить».
  const loadPreset = useCallback((p: PresetDef) => {
    const c = p.config || {};
    if (Array.isArray(c.blocks) && c.blocks.length) setBlocks(structuredClone(c.blocks));
    if (Array.isArray(c.display)) setDisplay([...c.display]);
    if (typeof c.horizon === 'number') setHorizon(c.horizon);
    if (typeof c.years === 'number') setYears(c.years);
    if (c.view === 'all' || c.view === 'tickers' || c.view === 'years') setView(c.view);
    setCfgNonce((n) => n + 1); // ремоунт uncontrolled-инпутов значений условий
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
      try {
        const r = await fetch('/api/researcher/presets');
        const j = await r.json().catch(() => ({}));
        if (Array.isArray(j?.presets)) setPresets(j.presets.map((p: any) => ({ id: String(p.id), name: String(p.name), description: String(p.description ?? ''), config: p.config && typeof p.config === 'object' ? p.config : { blocks: [] } })));
      } catch { /* нет БД — без сохранённых пресетов */ }
      try {
        const r = await fetch('/api/researcher/setups');
        const j = await r.json().catch(() => ({}));
        if (Array.isArray(j?.setups)) setSetups(j.setups.map((s: any) => ({ id: String(s.id), name: String(s.name), description: String(s.description ?? ''), config: s.config && typeof s.config === 'object' ? s.config : {}, snapshot: s.snapshot && typeof s.snapshot === 'object' ? s.snapshot : {} })));
      } catch { /* нет БД — без сетапов */ }
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

  // Дневные цены ПРИМЕНЁННОЙ вселенной — для графиков сделок (линия цены + периоды сделок). Грузим при смене
  // применённой вселенной, не на каждый ввод: условия/окно меняют набор сделок мгновенно поверх готовых цен.
  useEffect(() => {
    const syms = applied ? applied.uni.split(',').filter(Boolean) : [];
    if (!syms.length) { setPriceSeries({}); return; }
    let cancelled = false;
    setPricesLoading(true);
    (async () => {
      try {
        const r = await fetch('/api/researcher/prices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbols: syms }) });
        const j = await r.json().catch(() => ({}));
        if (!cancelled) setPriceSeries(j?.series && typeof j.series === 'object' ? j.series : {});
      } catch { if (!cancelled) setPriceSeries({}); }
      finally { if (!cancelled) setPricesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [applied]);

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

  // Активный сетап: текущий рецепт совпадает с сохранённым → подсветка чипа + метка в шапке.
  // Сбрасывается сам при любом изменении вселенной/условий/горизонта/окна.
  const curSig = useMemo(() => recipeSig(universe, blocks, horizon, years), [universe, blocks, horizon, years]);
  const activeSetupId = useMemo(() => setups.find((s) => recipeSig(parseUni(s.config?.uniText ?? ''), s.config?.blocks, s.config?.horizon, s.config?.years) === curSig)?.id ?? null, [setups, curSig]);
  const activeSetup = activeSetupId ? setups.find((s) => s.id === activeSetupId) : null;

  // Сетапы — сохранённые находки скринера (рецепт + снимок цифр + поток сделок) в БД, навсегда.
  const saveSetup = useCallback(async (name: string, description: string) => {
    const nm = name.trim(); if (!nm) return;
    if (!panel) { setErr('Сначала примените вселенную — нет данных для сетапа.'); return; }
    const id = setups.find((x) => x.name === nm)?.id ?? newId();
    const config: SetupCfg = { uniText, group, blocks, display, horizon, years, view };
    const snapshot: Record<string, number | string> = {
      n: consol.n, tickers: consol.tickers, hitPct: r2(consol.hitPct), avgRet: r2(consol.avgRet), medRet: r2(consol.medRet),
      avgMdd: r2(consol.avgMdd), avgMae: r2(consol.avgMae), avgMfe: r2(consol.avgMfe), avgExc: r2(consol.avgExc),
      tstat: r2(consol.tstat), pval: r2(consol.pval), horizon: panel.horizon || horizon,
      first: allDeals[0]?.date ?? '', last: allDeals[allDeals.length - 1]?.date ?? '',
    };
    // Ранжирующие колонки на ВХОД (показанные столбцы + факторы из условий) — те же значения, что в таблице
    // скринера (d.vals): «Портфели» ранжируют топ-K по любой из них без look-ahead. Исходы (ret/exc/…) — будущее.
    const streamCols = [...new Set([...displayCols, ...blk.flatMap((b) => b.conds.map((c) => c.col))])].slice(0, 40);
    const fv = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : r2(v as number));
    // Поток сделок: [date, symbol, ret, exc, mfe, mae, mdd, ...значения streamCols на дату входа].
    const stream = allDeals.map((d) => [d.date, d.symbol, r2(d.ret), r2(d.exc), r2(d.mfe), r2(d.mae), r2(d.mdd), ...streamCols.map((c) => fv(d.vals[c]))]);
    const desc = description.trim();
    setSetups((p) => [...p.filter((x) => x.name !== nm), { id, name: nm, description: desc, config, snapshot }]);
    setSetupSave(null);
    try {
      const res = await fetch('/api/researcher/setups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: nm, description: desc, config, snapshot, stream, streamCols }) });
      const j = await res.json().catch(() => ({})); if (j?.error) throw new Error(j.error);
    } catch (e: any) { setErr(`сетап не сохранён в БД: ${e?.message || e}`); }
  }, [setups, panel, consol, allDeals, displayCols, uniText, group, blocks, display, horizon, years, view]);
  const removeSetup = useCallback(async (id: string) => {
    setSetups((p) => p.filter((x) => x.id !== id));
    try { await fetch(`/api/researcher/setups?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* */ }
  }, []);
  // Загрузка сетапа: восстанавливаем рецепт (вселенная+условия+столбцы+горизонт+окно+вид) и пересчитываем (вселенная/горизонт изменились).
  const loadSetup = useCallback((s: SetupDef) => {
    const c = s.config || {};
    if (typeof c.uniText === 'string') setUniText(c.uniText);
    if (typeof c.group === 'string') setGroup(c.group);
    if (Array.isArray(c.blocks) && c.blocks.length) setBlocks(structuredClone(c.blocks));
    if (Array.isArray(c.display)) setDisplay([...c.display]);
    if (typeof c.years === 'number') setYears(c.years);
    if (c.view === 'all' || c.view === 'tickers' || c.view === 'years') setView(c.view);
    const hz = typeof c.horizon === 'number' ? c.horizon : horizon;
    if (typeof c.horizon === 'number') setHorizon(c.horizon);
    setCfgNonce((n) => n + 1);
    apply(parseUni(typeof c.uniText === 'string' ? c.uniText : uniText), hz);
  }, [apply, horizon, uniText]);
  // realtime-фильтры результата (мгновенно, поверх агрегатов строк)
  const passRf = (r: { n: number; hitPct: number; avgRet: number }) => r.n >= rf.minN && r.hitPct >= rf.minHit && r.avgRet >= rf.minRet;
  const byT = byTraw.filter(passRf);
  const byY = byYraw.filter(passRf);
  const matchedN = consol.n;
  const setB = (f: (b: UBlock[]) => UBlock[]) => setBlocks((prev) => f(structuredClone(prev)));
  const tColSpan = 10 + display.length;

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
              <button key={b.id} type="button" data-testid="basket-chip" className={`chip bskt${group === b.name ? ' on' : ''}`} title={b.tickers.join(', ')} onClick={() => { setGroup(b.name); setUniText(b.tickers.join(', ')); }}>
                {b.name}<span className="n">{b.tickers.length}</span>
                <span className="bx" onClick={(e) => { e.stopPropagation(); removeBasket(b.id); }} title="удалить корзину">✕</span>
              </button>
            ))}
          </div>
          <textarea className="uni" value={uniText} spellCheck={false} onChange={(e) => { setUniText(e.target.value); setGroup(''); }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn sm ghost" data-testid="basket-create-open" onClick={() => setBasketModal(true)}>➕ Создать корзину</button>
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
          {/* пресеты настроек (условия + столбцы + горизонт/окно/вид) — в БД навсегда */}
          <div className="presetbar">
            <span className="lbl">Пресеты:</span>
            {presets.map((p) => (
              <button key={p.id} type="button" data-testid="preset-chip" className="chip preset" title={p.description || 'без описания — клик загружает условия'} onClick={() => loadPreset(p)}>
                {p.name}
                <span className="bx" onClick={(e) => { e.stopPropagation(); removePreset(p.id); }} title="удалить пресет">✕</span>
              </button>
            ))}
            {presetSave === null
              ? <button type="button" className="btn sm ghost" data-testid="preset-save-open" onClick={() => setPresetSave({ name: group && !GROUPS[group] ? group : '', description: '' })}>💾 Сохранить пресет</button>
              : (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="rfin" style={{ width: 150, textAlign: 'left' }} autoFocus placeholder="имя пресета" data-testid="preset-name-input" value={presetSave.name} onChange={(e) => setPresetSave((s) => (s ? { ...s, name: e.target.value } : s))} onKeyDown={(e) => { if (e.key === 'Enter' && presetSave.name.trim()) savePreset(presetSave.name, presetSave.description); }} />
                  <input className="rfin" style={{ width: 230, textAlign: 'left' }} placeholder="описание (необязательно)" data-testid="preset-desc-input" value={presetSave.description} onChange={(e) => setPresetSave((s) => (s ? { ...s, description: e.target.value } : s))} />
                  <button type="button" className="btn sm" data-testid="preset-save-confirm" disabled={!presetSave.name.trim()} onClick={() => savePreset(presetSave.name, presetSave.description)}>Сохранить</button>
                  <button type="button" className="btn sm ghost" onClick={() => setPresetSave(null)}>отмена</button>
                </span>
              )}
            {presets.length === 0 && presetSave === null && <span className="sub">нет сохранённых — настройте условия и нажмите «Сохранить пресет»</span>}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="card-t">3 · Формулы (вычисляемые метрики)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="sub">выражения над факторами: + − × ÷, скобки, avg / min / max / sum / abs</span>
              <button type="button" className="btn sm ghost" data-testid="formula-help-open" onClick={() => setFormulaHelp(true)}>? Справка</button>
            </div>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="card-t">5 · Результаты</span>
              {activeSetup && <span className="badge brand" data-testid="active-setup" title="текущий рецепт совпадает с этим сетапом">✓ Сетап: {activeSetup.name}</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="sub">{!panel ? '' : view === 'all' ? `${consol.n} сделок · ${consol.tickers} тикеров`
                : view === 'tickers' ? `${matchedN} сделок · ${byT.length}${byT.length !== byTraw.length ? `/${byTraw.length}` : ''} тикеров`
                : `${matchedN} сделок · ${byY.length}${byY.length !== byYraw.length ? `/${byYraw.length}` : ''} лет`}</span>
              <div className="seg" style={{ width: 'auto' }}>
                {(['all', 'tickers', 'years'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} style={{ padding: '4px 10px' }}>{v === 'all' ? 'Сводно' : v === 'tickers' ? 'По тикерам' : 'По годам'}</button>)}
              </div>
            </div>
          </div>

          {/* Сетапы — сохранённые находки (рецепт + снимок цифр + поток сделок). Кирпичики для будущего раздела «Стратегии». */}
          <div className="setupbar">
            <span className="lbl">Сетапы:</span>
            {setups.map((s) => (
              <button key={s.id} type="button" data-testid="setup-chip" className={`chip setup${activeSetupId === s.id ? ' on' : ''}`} onClick={() => loadSetup(s)}
                title={`${s.description || 'без описания'}\nвселенная: ${s.config?.uniText || '—'}\nсделок ${s.snapshot?.n ?? '—'} · доля+ ${s.snapshot?.hitPct ?? '—'}% · ср.return ${s.snapshot?.avgRet ?? '—'}% · t-стат ${s.snapshot?.tstat ?? '—'} · горизонт ${s.config?.horizon ?? '—'}д · клик — загрузить`}>
                <b>{activeSetupId === s.id ? '✓ ' : ''}{s.name}</b>
                <span className="m">N {s.snapshot?.n ?? '—'} · ret {s.snapshot?.avgRet ?? '—'}% · t {s.snapshot?.tstat ?? '—'}</span>
                <span className="bx" onClick={(e) => { e.stopPropagation(); removeSetup(s.id); }} title="удалить сетап">✕</span>
              </button>
            ))}
            {setupSave === null
              ? <button type="button" className="btn sm" data-testid="setup-save-open" disabled={!panel} onClick={() => setSetupSave({ name: group && !GROUPS[group] ? group : '', description: '' })}>💾 Сохранить как сетап</button>
              : (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="rfin" style={{ width: 150, textAlign: 'left' }} autoFocus placeholder="имя сетапа" data-testid="setup-name-input" value={setupSave.name} onChange={(e) => setSetupSave((s) => (s ? { ...s, name: e.target.value } : s))} onKeyDown={(e) => { if (e.key === 'Enter' && setupSave.name.trim()) saveSetup(setupSave.name, setupSave.description); }} />
                  <input className="rfin" style={{ width: 200, textAlign: 'left' }} placeholder="описание (необязательно)" data-testid="setup-desc-input" value={setupSave.description} onChange={(e) => setSetupSave((s) => (s ? { ...s, description: e.target.value } : s))} />
                  <button type="button" className="btn sm" data-testid="setup-save-confirm" disabled={!setupSave.name.trim()} onClick={() => saveSetup(setupSave.name, setupSave.description)}>Сохранить</button>
                  <button type="button" className="btn sm ghost" onClick={() => setSetupSave(null)}>отмена</button>
                </span>
              )}
            {setups.length === 0 && setupSave === null && <span className="sub">сохрани находку: вселенная + условия + цифры → кирпичик для будущих стратегий</span>}
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
                <span className="card-t">График сделок · цена актива по годам</span>
                <span className="sub">{pricesLoading ? 'загрузка цен…' : `${new Set(allDeals.map((d) => d.symbol)).size} активов со сделками`}</span>
              </div>
              <PriceLines series={priceSeries} deals={allDeals} horizon={panel.horizon || horizon} minYear={minYear} onExpand={setDetailSym} />
              <p className="sub" style={{ marginTop: 6 }}>Карточка на актив со сделками: линия — цена по годам; <span className="up">зелёная</span>/<span className="down">красная</span> полоса отмечает период сделки (вход … +{panel.horizon || horizon}д), цвет — знак форварда; точка — вход.</p>
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
          {panel && <p className="foot" data-testid="panel-meta">Клик по строке → провал внутрь сделок. Панель: {panel.meta?.obs} сделок, {panel.symbols.length} тикеров, {panel.meta?.first} … {panel.meta?.last} · форвард {panel.horizon}д · окно {years} лет{minYear ? ` (с ${minYear})` : ''}.</p>}
        </div>
      </div>

      {drill && panel && <Drawer panel={panel} blocks={blk} drill={drill} horizon={panel.horizon || horizon} minYear={minYear} formulas={fmap} display={displayCols} colLabel={colLabel} series={priceSeries} onExpand={setDetailSym} onClose={() => setDrill(null)} />}

      {detailSym && <AssetDetail key={detailSym} sym={detailSym} series={priceSeries[detailSym] || []} deals={allDeals.filter((d) => d.symbol === detailSym)} horizon={(panel?.horizon) || horizon} minYear={minYear} onClose={() => setDetailSym(null)} />}

      {basketModal && <BasketModal existing={baskets} onSave={saveBasket} onClose={() => setBasketModal(false)} />}

      {formulaHelp && <FormulaHelp onInsert={(name, expr) => setFormulas((p) => [...p, { id: newId(), name, expr, savedName: '', savedExpr: '' }])} onClose={() => setFormulaHelp(false)} />}

      <FormulaChat
        factors={MID.map((id) => ({ id, label: METRICS[id].label, periods: METRICS[id].periods }))}
        onInsert={(name, expr) => { setFormulas((p) => [...p, { id: newId(), name, expr, savedName: '', savedExpr: '' }]); }}
      />
    </main>
  );
}

function Drawer({ panel, blocks, drill, horizon, minYear, formulas, display, colLabel, series, onExpand, onClose }: { panel: ScreenPanel; blocks: Block[]; drill: { kind: 't' | 'y'; kv: string }; horizon: number; minYear?: number; formulas: Formulas; display: string[]; colLabel: (k: string) => string; series: Record<string, { date: string; close: number }[]>; onExpand?: (sym: string) => void; onClose: () => void }) {
  const deals = screenDeals(panel, blocks, drill.kind, drill.kv, minYear, formulas);
  const st = dealStats(deals);
  // Окно графика: для разреза по году — только этот год; для тикера — текущее окно лет (с minYear).
  const drillYear = drill.kind === 'y' ? +drill.kv : undefined;
  const chartMinYear = drillYear ?? minYear;
  const chartWinEnd = drillYear ? Date.parse(`${drillYear + 1}-01-01T00:00:00Z`) : undefined;
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
          {deals.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="chart-head"><span className="card-t">Цена{drill.kind === 'y' ? ` · ${drill.kv}` : ' по годам'} и периоды сделок</span></div>
              <PriceLines series={series} deals={deals} horizon={horizon} minYear={chartMinYear} winEnd={chartWinEnd} onExpand={onExpand} />
            </div>
          )}
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

// График сделок: на каждый актив со сделками — карточка с ценой по годам (линия) и периодами сделок
// (полупрозрачные полосы [вход … вход+горизонт], цвет = знак форварда). Чистый SVG, без зависимостей.
function PriceLines({ series, deals, horizon, minYear, winEnd, onExpand }: { series: Record<string, { date: string; close: number }[]>; deals: Deal[]; horizon: number; minYear?: number; winEnd?: number; onExpand?: (sym: string) => void }) {
  const bySym = useMemo(() => {
    const m = new Map<string, Deal[]>();
    for (const d of deals) { const a = m.get(d.symbol); if (a) a.push(d); else m.set(d.symbol, [d]); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [deals]);
  if (!bySym.length) return <p className="sub" style={{ padding: '20px 0' }}>Нет сделок — ослабьте условия или расширьте окно лет.</p>;
  const winStart = minYear ? Date.parse(`${minYear}-01-01T00:00:00Z`) : -Infinity;
  const winEndMs = winEnd ?? Infinity;
  return (
    <div className="pl-grid" data-testid="deal-line-charts">
      {bySym.map(([sym, ds]) => <AssetChart key={sym} sym={sym} series={series[sym] || []} deals={ds} horizon={horizon} winStart={winStart} winEnd={winEndMs} onExpand={onExpand} />)}
    </div>
  );
}

function AssetChart({ sym, series, deals, horizon, winStart, winEnd, onExpand }: { sym: string; series: { date: string; close: number }[]; deals: Deal[]; horizon: number; winStart: number; winEnd: number; onExpand?: (sym: string) => void }) {
  const pts = useMemo(() => series
    .map((r) => ({ t: Date.parse(r.date + 'T00:00:00Z'), c: r.close }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.c) && p.t >= winStart && p.t <= winEnd)
    .sort((a, b) => a.t - b.t), [series, winStart, winEnd]);
  const W = 460, H = 190, mL = 38, mR = 8, mT = 18, mB = 18;
  const iw = W - mL - mR, ih = H - mT - mB;
  if (pts.length < 2) return (
    <div className="pl-card" data-testid="deal-line-chart">
      <div className="pl-h"><span className="sy">{sym}</span><span className="sub">{deals.length} сделок · нет цен</span></div>
      <div className="sub" style={{ padding: '34px 0', textAlign: 'center' }}>нет ценового ряда</div>
    </div>
  );
  const ts = pts.map((p) => p.t), cs = pts.map((p) => p.c);
  const t0 = ts[0], t1 = ts[ts.length - 1];
  let cmin = Math.min(...cs), cmax = Math.max(...cs);
  if (cmin === cmax) { cmin -= 1; cmax += 1; }
  const pad = (cmax - cmin) * 0.08; cmin -= pad; cmax += pad;
  const X = (t: number) => mL + (t1 === t0 ? iw / 2 : ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * iw);
  const Y = (v: number) => mT + ((cmax - v) / (cmax - cmin)) * ih;
  const closeAt = (t: number) => { let best = pts[0]; for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; return best.c; };
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.c).toFixed(1)}`).join(' ');
  const winMs = horizon * (7 / 5) * 864e5; // горизонт в торговых днях ≈ календарные (5 торговых ≈ 7 календарных)
  const bands = deals.map((d) => {
    const te = Date.parse(d.date + 'T00:00:00Z');
    return { x0: X(te), x1: X(te + winMs), up: d.ret > 0, te };
  }).filter((b) => Number.isFinite(b.x0));
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  const yearsArr: number[] = []; for (let yy = y0; yy <= y1; yy++) yearsArr.push(yy);
  const step = Math.max(1, Math.ceil(yearsArr.length / 6));
  const t3 = 'var(--fk-text-3)', line = 'var(--fk-line)', up = 'var(--fk-up,#12b981)', down = 'var(--fk-down,#f43f5e)';
  return (
    <div className={`pl-card${onExpand ? ' click' : ''}`} data-testid="deal-line-chart" onClick={onExpand ? () => onExpand(sym) : undefined} title={onExpand ? 'Открыть крупно — зум и метрики выбранного периода' : undefined}>
      <div className="pl-h"><span className="sy">{sym}</span><span className="sub">{deals.length} сделок{onExpand ? ' · ⤢' : ''}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
        {bands.map((b, i) => (
          <rect key={`b${i}`} x={Math.min(b.x0, b.x1)} y={mT} width={Math.max(1.4, Math.abs(b.x1 - b.x0))} height={ih} style={{ fill: b.up ? up : down, fillOpacity: 0.16 }} />
        ))}
        {yearsArr.filter((yy) => (yy - y0) % step === 0).map((yy) => {
          const xx = X(Date.parse(`${yy}-01-01T00:00:00Z`));
          return <g key={`y${yy}`}><line x1={xx} x2={xx} y1={mT} y2={H - mB} style={{ stroke: line }} /><text x={xx} y={H - 5} textAnchor="middle" fontSize="9" style={{ fill: t3 }}>{yy}</text></g>;
        })}
        {[cmax, (cmin + cmax) / 2, cmin].map((v, i) => (
          <text key={`p${i}`} x={mL - 5} y={Y(v) + 3} textAnchor="end" fontSize="9" style={{ fill: t3 }}>{Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(1)}</text>
        ))}
        <path d={path} data-testid="deal-line" fill="none" style={{ stroke: 'var(--fk-text-2,#475569)', strokeWidth: 1.3 }} />
        {bands.map((b, i) => (b.te >= t0 && b.te <= t1) ? <circle key={`m${i}`} cx={X(b.te)} cy={Y(closeAt(b.te))} r={2.2} style={{ fill: b.up ? up : down }} /> : null)}
      </svg>
    </div>
  );
}

// Детальный просмотр актива: крупный график с зумом (колесо мыши + кнопки) и выделением периода
// перетаскиванием → метрики (return/MaxDD/MAE/MFE, hit-rate, t-стат, p-value) именно за выбранный отрезок.
// Чистый SVG + ручной маппинг пиксель↔время; никаких зависимостей.
function AssetDetail({ sym, series, deals, horizon, minYear, onClose }: { sym: string; series: { date: string; close: number }[]; deals: Deal[]; horizon: number; minYear?: number; onClose: () => void }) {
  const winStart = minYear ? Date.parse(`${minYear}-01-01T00:00:00Z`) : -Infinity;
  const allPts = useMemo(() => series
    .map((r) => ({ t: Date.parse(r.date + 'T00:00:00Z'), c: r.close }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.c) && p.t >= winStart)
    .sort((a, b) => a.t - b.t), [series, winStart]);
  const full: [number, number] = allPts.length ? [allPts[0].t, allPts[allPts.length - 1].t] : [0, 1];
  const [dom, setDom] = useState<[number, number]>(full);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  // Перетаскивание окна на полосе-скруббере: move — двигаем целиком, l/r — тянем край.
  const [scrub, setScrub] = useState<{ mode: 'move' | 'l' | 'r'; startT: number; startSel: [number, number] } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stripRef = useRef<SVGSVGElement>(null);
  const W = 900, H = 380, mL = 52, mR = 14, mT = 16, mB = 26;
  const iw = W - mL - mR, ih = H - mT - mB;
  const [d0, d1] = dom;

  const xToTime = useCallback((clientX: number) => {
    const el = svgRef.current; if (!el) return d0;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, ((clientX - rect.left) / rect.width * W - mL) / iw));
    return d0 + frac * (d1 - d0);
  }, [d0, d1, iw]);

  // Полоса-скруббер мапит ВЕСЬ период (full) на свою ширину (без полей — согласовано с sToTime).
  const sToTime = useCallback((clientX: number) => {
    const el = stripRef.current; if (!el) return full[0];
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return full[0] + frac * (full[1] - full[0]);
  }, [full[0], full[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // Сброс окна/выделения при смене ряда (асинхронный до-фетч цен, пока окно открыто): иначе домен/оси
  // остались бы от прошлого ряда. Смена символа и так ремоунтит компонент (key=detailSym).
  useEffect(() => { setDom([full[0], full[1]]); setSel(null); setDrag(null); }, [full[0], full[1]]);

  // Колесо мыши = масштаб по времени, центрированный на курсоре. Нативный listener — на passive React
  // onWheel preventDefault не сработал бы (страница бы скроллилась).
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const tc = xToTime(e.clientX);
      const f = e.deltaY > 0 ? 1.25 : 0.8;
      let n0 = tc - (tc - d0) * f, n1 = tc + (d1 - tc) * f;
      // Зум-аут: переполнение за край перекидываем на противоположную сторону, чтобы окно всегда
      // расширялось (иначе у прижатого края и курсора на нём колесо «застревало»).
      if (f > 1) {
        if (n0 < full[0]) { n1 = Math.min(full[1], n1 + (full[0] - n0)); n0 = full[0]; }
        if (n1 > full[1]) { n0 = Math.max(full[0], n0 - (n1 - full[1])); n1 = full[1]; }
      }
      n0 = Math.max(full[0], n0); n1 = Math.min(full[1], n1);
      if (n1 - n0 > 6 * 864e5 && (n0 !== d0 || n1 !== d1)) setDom([n0, n1]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [d0, d1, full[0], full[1], xToTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: { clientX: number }) => { const t = xToTime(e.clientX); setDrag([t, t]); setSel(null); };
  const onMove = (e: { clientX: number }) => { setDrag((dr) => (dr ? [dr[0], xToTime(e.clientX)] : dr)); };
  const onUp = () => { if (!drag) return; const lo = Math.min(drag[0], drag[1]), hi = Math.max(drag[0], drag[1]); setSel(hi - lo > (d1 - d0) * 0.01 ? [lo, hi] : null); setDrag(null); };
  const zoomOut = () => { const c = (d0 + d1) / 2, h = (d1 - d0) * 0.75; setDom([Math.max(full[0], c - h), Math.min(full[1], c + h)]); };

  // Скруббер: тянем окно/края по всему периоду. Глобальные listener-ы — чтобы тащить и за пределами полосы.
  useEffect(() => {
    if (!scrub) return;
    const MIN = 6 * 864e5;
    const onMM = (e: MouseEvent) => {
      const t = sToTime(e.clientX);
      const [a0, b0] = scrub.startSel;
      if (scrub.mode === 'move') {
        const width = b0 - a0, dt = t - scrub.startT;
        let a = a0 + dt, b = b0 + dt;
        if (a < full[0]) { a = full[0]; b = a + width; }
        if (b > full[1]) { b = full[1]; a = b - width; }
        setSel([a, b]);
      } else if (scrub.mode === 'l') {
        setSel([Math.max(full[0], Math.min(t, b0 - MIN)), b0]);
      } else {
        setSel([a0, Math.min(full[1], Math.max(t, a0 + MIN))]);
      }
    };
    const onMU = () => setScrub(null);
    window.addEventListener('mousemove', onMM);
    window.addEventListener('mouseup', onMU);
    return () => { window.removeEventListener('mousemove', onMM); window.removeEventListener('mouseup', onMU); };
  }, [scrub, full[0], full[1], sToTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const sDown = (e: { clientX: number }) => {
    const el = stripRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const toPx = (tt: number) => ((tt - full[0]) / (full[1] - full[0] || 1)) * rect.width;
    const px = e.clientX - rect.left, HANDLE = 10;
    // Есть выделение → двигаем окно / тянем край. Нет (окно = весь период) → тянем новое выделение.
    if (sel) {
      const lpx = toPx(sel[0]), rpx = toPx(sel[1]);
      if (Math.abs(px - lpx) <= HANDLE) { setScrub({ mode: 'l', startT: sToTime(e.clientX), startSel: sel }); return; }
      if (Math.abs(px - rpx) <= HANDLE) { setScrub({ mode: 'r', startT: sToTime(e.clientX), startSel: sel }); return; }
      if (px > lpx && px < rpx) { setScrub({ mode: 'move', startT: sToTime(e.clientX), startSel: sel }); return; }
    }
    const t = sToTime(e.clientX); setSel([t, t]); setScrub({ mode: 'r', startT: t, startSel: [t, t] });
  };

  const vis = allPts.filter((p) => p.t >= d0 && p.t <= d1);
  // Узкий зум может оставить в окне <2 точек (разреженный/даунсэмпленный ряд). Тогда берём окно + по
  // одному соседу с каждой стороны — линия и ось Y отражают ВИДИМЫЙ участок, а не весь ряд.
  const useP = vis.length >= 2 ? vis : (() => {
    let lo = allPts.findIndex((p) => p.t >= d0); if (lo < 0) lo = allPts.length - 1;
    return allPts.slice(Math.max(0, lo - 1), Math.min(allPts.length, lo + 2));
  })();
  const fmtD = (t: number) => new Date(t).toISOString().slice(0, 10);

  const selDeals = sel ? deals.filter((d) => { const te = Date.parse(d.date + 'T00:00:00Z'); return te >= sel[0] && te <= sel[1]; }) : deals;
  const st = dealStats(selDeals);
  const stats: [string, string, string][] = [
    ['Сделок', String(st.n), ''], ['Доля +', st.hitPct.toFixed(0) + '%', ''],
    ['Ср. return', fnum(st.avgRet) + '%', cls(st.avgRet)], ['Медиана', fnum(st.medRet) + '%', cls(st.medRet)],
    ['Просадка', fnum(st.avgMdd) + '%', 'down'], ['MAE', fnum(st.avgMae) + '%', 'down'], ['MFE', fnum(st.avgMfe) + '%', 'up'],
    ['vs SPY', fnum(st.avgExc) + '%', cls(st.avgExc)],
    ['t-стат', st.tstat.toFixed(2), Math.abs(st.tstat) >= 2 ? 'up' : ''], ['p-value', st.pval.toFixed(3), st.pval <= 0.05 ? 'up' : ''],
  ];

  // Масштабы (Y по видимому окну — детали цены видны при зуме)
  let cmin = Infinity, cmax = -Infinity;
  for (const p of useP) { if (p.c < cmin) cmin = p.c; if (p.c > cmax) cmax = p.c; }
  if (!Number.isFinite(cmin) || cmin === cmax) { cmin = (cmin || 0) - 1; cmax = (cmax || 0) + 1; }
  const padc = (cmax - cmin) * 0.08; cmin -= padc; cmax += padc;
  const X = (t: number) => mL + (d1 === d0 ? iw / 2 : ((Math.min(Math.max(t, d0), d1) - d0) / (d1 - d0)) * iw);
  const Y = (v: number) => mT + ((cmax - v) / (cmax - cmin)) * ih;
  const closeAt = (t: number) => { let best = useP[0]; for (const p of useP) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; return best.c; };
  const path = useP.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.c).toFixed(1)}`).join(' ');
  const winMs = horizon * (7 / 5) * 864e5;
  const bands = deals.map((d) => { const te = Date.parse(d.date + 'T00:00:00Z'); return { te, up: d.ret > 0 }; }).filter((b) => Number.isFinite(b.te) && b.te + winMs >= d0 && b.te <= d1);
  const y0 = new Date(d0).getUTCFullYear(), y1 = new Date(d1).getUTCFullYear();
  const yearsArr: number[] = []; for (let yy = y0; yy <= y1; yy++) yearsArr.push(yy);
  const ystep = Math.max(1, Math.ceil(yearsArr.length / 9));
  const t3 = 'var(--fk-text-3)', line = 'var(--fk-line)', up = 'var(--fk-up,#12b981)', down = 'var(--fk-down,#f43f5e)', brand = 'var(--fk-brand-700,#2563eb)';
  const brush = drag || sel;

  // Полоса-скруббер: весь период с мини-спарклайном и подвижным окном (= sel, либо весь период).
  const SW = 900, SH = 30;
  const sX = (t: number) => ((t - full[0]) / (full[1] - full[0] || 1)) * SW;
  const sWin = sel ?? full;
  const swx0 = sX(sWin[0]), swx1 = sX(sWin[1]);
  let sfmin = Infinity, sfmax = -Infinity;
  for (const p of allPts) { if (p.c < sfmin) sfmin = p.c; if (p.c > sfmax) sfmax = p.c; }
  const sStep = Math.max(1, Math.ceil(allPts.length / 220));
  const sparkPath = allPts.filter((_, i) => i % sStep === 0).map((p, i) => `${i ? 'L' : 'M'}${sX(p.t).toFixed(1)} ${(3 + (SH - 6) * (1 - (p.c - sfmin) / ((sfmax - sfmin) || 1))).toFixed(1)}`).join(' ');

  return (
    <div className="rsx">
      <div className="rsx-scrim" style={{ zIndex: 70 }} onClick={onClose} />
      <div className="rsx-detail" data-testid="asset-detail">
        <div className="dr-h">
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{sym} · цена и сделки</div>
            <div className="sub" style={{ marginTop: 3 }}>{sel ? `Период ${fmtD(sel[0])} … ${fmtD(sel[1])} · ${st.n} сделок` : 'Весь период · выделите участок мышью для метрик периода'}</div>
          </div>
          <span className="x" onClick={onClose}>✕</span>
        </div>
        <div className="dt-b">
          <div className="dt-ctrl">
            <button type="button" className="btn sm ghost" onClick={() => setDom(full)} disabled={d0 === full[0] && d1 === full[1]}>Сбросить масштаб</button>
            <button type="button" className="btn sm ghost" onClick={zoomOut} disabled={d0 === full[0] && d1 === full[1]}>− Отдалить</button>
            {sel && <button type="button" className="btn sm" data-testid="detail-zoom-sel" onClick={() => { const MIN = 6 * 864e5; let [a, b] = sel; if (b - a < MIN) { const c = (a + b) / 2; a = Math.max(full[0], c - MIN / 2); b = Math.min(full[1], c + MIN / 2); } setDom([a, b]); }}>Приблизить к выделению</button>}
            {sel && <button type="button" className="btn sm ghost" onClick={() => setSel(null)}>Снять выделение</button>}
            <span className="sub">колесо мыши — масштаб · перетаскивание — выделить период</span>
          </div>
          {allPts.length < 2 ? <p className="sub" style={{ padding: '40px 0', textAlign: 'center' }}>Нет ценового ряда для «{sym}».</p> : (
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} data-testid="asset-detail-svg" style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair', touchAction: 'none', userSelect: 'none' }}
              onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
              {bands.map((b, i) => { const x = X(b.te), x2 = X(b.te + winMs); return <rect key={`b${i}`} x={Math.min(x, x2)} y={mT} width={Math.max(1.6, Math.abs(x2 - x))} height={ih} style={{ fill: b.up ? up : down, fillOpacity: 0.16 }} />; })}
              {yearsArr.filter((yy) => (yy - y0) % ystep === 0).map((yy) => { const xx = X(Date.parse(`${yy}-01-01T00:00:00Z`)); return <g key={`y${yy}`}><line x1={xx} x2={xx} y1={mT} y2={H - mB} style={{ stroke: line }} /><text x={xx} y={H - 8} textAnchor="middle" fontSize="10" style={{ fill: t3 }}>{yy}</text></g>; })}
              {[cmax, (cmin + cmax) / 2, cmin].map((v, i) => <g key={`p${i}`}><line x1={mL} x2={W - mR} y1={Y(v)} y2={Y(v)} style={{ stroke: line }} /><text x={mL - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" style={{ fill: t3 }}>{Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(1)}</text></g>)}
              {brush && (() => { const a = X(Math.min(brush[0], brush[1])), b = X(Math.max(brush[0], brush[1])); return <rect x={a} y={mT} width={Math.max(1, b - a)} height={ih} style={{ fill: brand, fillOpacity: 0.1, stroke: brand, strokeDasharray: '4 3' }} />; })()}
              <path d={path} fill="none" data-testid="detail-line" style={{ stroke: 'var(--fk-text-2,#475569)', strokeWidth: 1.4 }} />
              {bands.map((b, i) => (b.te >= d0 && b.te <= d1) ? <circle key={`m${i}`} cx={X(b.te)} cy={Y(closeAt(b.te))} r={3.2} style={{ fill: b.up ? up : down, stroke: '#fff', strokeWidth: 0.8 }} /> : null)}
            </svg>
          )}
          {allPts.length >= 2 && (
            <div style={{ marginTop: 8 }}>
              <svg ref={stripRef} viewBox={`0 0 ${SW} ${SH}`} data-testid="asset-detail-scrubber" preserveAspectRatio="none"
                style={{ display: 'block', width: '100%', height: 30, cursor: 'ew-resize', touchAction: 'none', userSelect: 'none' }} onMouseDown={sDown}>
                <rect x={0} y={2} width={SW} height={SH - 4} rx={4} style={{ fill: 'var(--fk-surface-2)' }} />
                <path d={sparkPath} fill="none" vectorEffect="non-scaling-stroke" style={{ stroke: t3, strokeWidth: 1, opacity: 0.65 }} />
                <rect x={Math.min(swx0, swx1)} y={1} width={Math.max(2, Math.abs(swx1 - swx0))} height={SH - 2} rx={3} style={{ fill: brand, fillOpacity: 0.14, stroke: brand, strokeWidth: 1 }} vectorEffect="non-scaling-stroke" />
                <rect x={swx0 - 2.5} y={4} width={5} height={SH - 8} rx={2} style={{ fill: brand }} />
                <rect x={swx1 - 2.5} y={4} width={5} height={SH - 8} rx={2} style={{ fill: brand }} />
              </svg>
              <div className="sub" style={{ marginTop: 3 }}>Полоса периода: тяните окно или его края — метрики ниже считаются за выбранный период{sel ? '' : ' (сейчас — весь период)'}.</div>
            </div>
          )}
          <div className="statgrid" style={{ marginTop: 14 }} data-testid="detail-stats">
            {st.n === 0
              ? <div className="sub" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '6px 0' }}>В выбранном периоде нет сделок — выделите участок с точками входа.</div>
              : stats.map(([k, v, t]) => <div className="stat" key={k}><div className="k">{k}</div><div className={`v ${t}`}>{v}</div></div>)}
          </div>
        </div>
      </div>
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

// Справка по разделу «Формулы»: что это, как пользоваться, синтаксис, таблица факторов/функций, семантика null
// и готовые сложные примеры с кнопкой «Вставить» (кладёт черновик в список формул — остаётся проверить и «Сохранить»).
function FormulaHelp({ onInsert, onClose }: { onInsert: (name: string, expr: string) => void; onClose: () => void }) {
  const examples: { name: string; expr: string; note: string }[] = [
    { name: 'mom3', expr: 'avg(momentum[21], momentum[63], momentum[126])', note: 'Композитный моментум: среднее по 3 горизонтам — сглаживает шум отдельного окна.' },
    { name: 'mom_risk', expr: 'momentum[63] / vol[63]', note: 'Sharpe-подобное: доходность на единицу риска. Выше — качественнее рост.' },
    { name: 'z_dip', expr: 'momentum[21] / vol[21] * sqrt(252)', note: 'Моментум 21д к ДНЕВНОЙ волатильности: vol годовая, поэтому ×√252 «разгодовляет» её до дневной.' },
    { name: 'xvadj3', expr: 'avg(xvadj[21], xvadj[63], xvadj[126])', note: 'Превышение бенчмарка с поправкой на волатильность, усреднённое по горизонтам.' },
    { name: 'mom_dd', expr: 'momentum[126] + dist_ath[0] * 0.5', note: 'Моментум со штрафом за просадку: dist_ath[0] ≤ 0, поэтому глубокий провал от максимума снижает счёт.' },
    { name: 'dip', expr: 'rsi[14] + sma_dist[50]', note: 'Скор перепроданности: ниже — глубже провал у своей средней (кандидат на отскок).' },
    { name: 'xb_risk', expr: 'xbench[63] / vol[63]', note: 'Риск-скорректированное превышение бенчмарка: превышение на единицу волатильности.' },
    { name: 'mom_w', expr: '(momentum[21] * 3 + momentum[63] * 2 + momentum[126]) / 6', note: 'Взвешенный моментум: недавние окна важнее (веса 3-2-1).' },
    { name: 'mom_all', expr: 'min(momentum[21], momentum[63], momentum[126])', note: 'Худший из горизонтов: условие «≥ 0» тогда требует роста НА ВСЕХ окнах сразу.' },
  ];
  return (
    <div className="rsx">
      <div className="rsx-scrim" onClick={onClose} />
      <div className="rsx-modal wide fhelp" data-testid="formula-help">
        <div className="dr-h">
          <div style={{ fontSize: 15, fontWeight: 700 }}>Справка · как составлять формулы</div>
          <span className="x" onClick={onClose}>✕</span>
        </div>
        <div className="md-b">
          <section className="fh-s">
            <h4>Что это</h4>
            <p>Формула — своя вычисляемая метрика поверх факторов панели. Задаёте <b>имя</b> и <b>выражение</b> → после «Сохранить» она доступна и как <b>столбец</b> таблицы, и как <b>условие</b> отбора наравне с базовыми факторами.</p>
          </section>
          <section className="fh-s">
            <h4>Как пользоваться</h4>
            <ol>
              <li>Нажмите «+ формула» и придумайте короткое <b>имя</b> латиницей (не совпадающее с фактором).</li>
              <li>Впишите <b>выражение</b> из факторов и операторов (примеры ниже).</li>
              <li>Нажмите <b>«Сохранить»</b> — формула проверится и сохранится в БД навсегда.</li>
              <li>Добавьте её столбцом (карточка 4) или условием (карточка 2), напр. <code>mom3 ≥ 10</code>.</li>
            </ol>
          </section>
          <section className="fh-s">
            <h4>Синтаксис</h4>
            <ul>
              <li>Ссылка на фактор: <code>momentum[63]</code> или <code>momentum_63</code> — фактор и период в днях.</li>
              <li>Операторы: <code>+ − × ÷</code> (можно <code>*</code> и <code>/</code>), скобки <code>( )</code>, унарный минус.</li>
              <li>Функции: <code>avg, min, max, sum</code> (≥1 арг.), <code>abs, sqrt, log, sign</code> (1 арг.), <code>pow(x, y)</code>.</li>
              <li>Числа-константы можно: <code>momentum[126] * 0.5</code>, <code>sqrt(252)</code>.</li>
            </ul>
          </section>
          <section className="fh-s">
            <h4>Доступные факторы</h4>
            <table className="fh-tab">
              <thead><tr><th>Фактор</th><th>Ключ</th><th>Периоды (дн.)</th><th>Ед.</th></tr></thead>
              <tbody>
                {Object.entries(METRICS).map(([id, m]) => (
                  <tr key={id}><td>{m.label}</td><td><code>{id}</code></td><td>{m.periods.map((p) => (id === 'dist_ath' && p === 0 ? 'ATH' : p)).join(', ')}</td><td>{m.unit || '—'}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="sub" style={{ marginTop: 6 }}>Напоминание: <code>vol</code> — <b>годовая</b> волатильность (×√252); <code>xbench</code>/<code>xvadj</code> — в пп относительно бенчмарка; <code>dist_ath[0]</code> ≤ 0 (расстояние до исторического максимума).</p>
          </section>
          <section className="fh-s">
            <h4>Пустые значения (null)</h4>
            <p>Если хотя бы один фактор в выражении не определён (нет данных) — вся метрика становится <b>null</b>, и такая сделка <b>не проходит</b> условие. Деление на 0 и домен-ошибки (<code>sqrt</code> из отрицательного, <code>log</code> ≤ 0) тоже дают null.</p>
          </section>
          <section className="fh-s">
            <h4>Готовые сложные формулы</h4>
            <p className="sub" style={{ marginBottom: 8 }}>«Вставить» кладёт формулу черновиком в карточку 3 — останется проверить и «Сохранить».</p>
            <div className="fh-ex">
              {examples.map((ex) => <HelpExample key={ex.name} ex={ex} onInsert={onInsert} />)}
            </div>
          </section>
        </div>
        <div className="md-f">
          <button type="button" className="btn ghost sm" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

// Одна готовая формула в справке: имя = выражение, пояснение и кнопка «Вставить» (одноразовая).
function HelpExample({ ex, onInsert }: { ex: { name: string; expr: string; note: string }; onInsert: (n: string, e: string) => void }) {
  const [added, setAdded] = useState(false);
  return (
    <div className="fh-card">
      <div className="fh-top">
        <code className="fh-expr"><b>{ex.name}</b> = {ex.expr}</code>
        {added
          ? <span className="fok">✓ вставлено</span>
          : <button type="button" className="btn sm" data-testid="formula-help-insert" onClick={() => { onInsert(ex.name, ex.expr); setAdded(true); }}>Вставить</button>}
      </div>
      <div className="fh-note">{ex.note}</div>
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
          <button type="button" className="btn sm" disabled={!arr.length} onClick={() => { onApply(arr, false); setDone(`добавлено ${arr.length}`); }}>Добавить выбранные</button>
          <button type="button" className="btn sm ghost" disabled={!arr.length} onClick={() => { onApply(arr, true); setDone(`список заменён (${arr.length})`); }}>Заменить список</button>
        </div>
      )}
    </div>
  );
}

// Модалка «Создать корзину»: собираем список тикеров ВРУЧНУЮ (ввод + «Добавить») или через AI-подбор,
// видим состав чипами (клик убирает), задаём имя и сохраняем в БД. Не трогает текущую вселенную скринера.
function BasketModal({ existing, onSave, onClose }: { existing: { name: string }[]; onSave: (name: string, tickers: string[]) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const [manual, setManual] = useState('');
  const [ai, setAi] = useState(false);
  const merge = (ts: string[], replace: boolean) => setDraft((d) => [...new Set([...(replace ? [] : d), ...ts.map((t) => t.toUpperCase())])].slice(0, 40));
  const addManual = () => { const add = parseUni(manual); if (add.length) merge(add, false); setManual(''); };
  const dup = !!name.trim() && existing.some((b) => b.name === name.trim());
  const canAddManual = parseUni(manual).length > 0;
  return (
    <div className="rsx">
      <div className="rsx-scrim" onClick={onClose} />
      <div className="rsx-modal" data-testid="basket-modal">
        <div className="dr-h">
          <div style={{ fontSize: 15, fontWeight: 700 }}>Создать корзину</div>
          <span className="x" onClick={onClose}>✕</span>
        </div>
        <div className="md-b">
          <label className="mlbl">Название корзины</label>
          <input className="min" data-testid="basket-modal-name" autoFocus placeholder="например, Полупроводники" value={name} onChange={(e) => setName(e.target.value)} />
          {dup && <span className="sub" style={{ color: 'var(--fk-warn-text,#b5740a)', fontWeight: 600 }}>Корзина «{name.trim()}» уже есть — будет перезаписана.</span>}

          <label className="mlbl" style={{ marginTop: 12 }}>Тикеры вручную</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="min" data-testid="basket-modal-manual" placeholder="SMH, SOXX, NVDA…" value={manual}
              onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }} />
            <button type="button" className="btn sm" data-testid="basket-modal-add" disabled={!canAddManual} onClick={addManual}>+ Добавить</button>
          </div>
          <button type="button" className={`btn sm ghost${ai ? ' on' : ''}`} style={{ marginTop: 8 }} onClick={() => setAi((o) => !o)}>✨ AI-подбор тикеров</button>
          {ai && <UniverseChat onApply={merge} onClose={() => setAi(false)} />}

          <label className="mlbl" style={{ marginTop: 12 }}>Состав корзины · {draft.length}</label>
          <div className="grp" data-testid="basket-modal-draft" style={{ marginBottom: 0 }}>
            {draft.length
              ? draft.map((t) => <button key={t} type="button" className="chip bskt on" title="убрать" onClick={() => setDraft((d) => d.filter((x) => x !== t))}>{t}<span className="bx">✕</span></button>)
              : <span className="sub">пусто — добавьте тикеры вручную или через AI</span>}
          </div>
        </div>
        <div className="md-f">
          <button type="button" className="btn apply on" data-testid="basket-modal-save" disabled={!name.trim() || !draft.length} onClick={() => onSave(name, draft)}>Сохранить корзину</button>
          <button type="button" className="btn ghost sm" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
