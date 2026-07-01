'use client';

// Раздел «Портфели»: тесты стратегий из СЕТАПОВ. Путь — пошаговый мастер:
//   Новый тест → 1) вселенная (сетапы) → 2) ребалансировка → 3) параметры → 4) запуск → автосохранение
//   с именем от AI. Метрики/кривую считает сервер по сигналам сетапов и дневным ценам (/compute).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PortfolioResult, DayPoint } from '@/lib/research/portfolioEngine';

type Parking = 'BIL' | 'SPY' | 'CASH';
type ExecMode = 'ladder' | 'weekly' | 'monthly';
type SetupItem = { id: string; name: string; snapshot?: Record<string, number | string> };
type PortfolioSnapshot = { cagr?: number | null; loading?: number | null; excessActive?: number | null; sharpe?: number | null; maxDD?: number | null; winRateVsSpy?: number | null; total?: number | null; start?: string | null; end?: string | null };
type SavedConfig = { setupIds: string[]; execution: ExecMode; ladderN: number; parking: Parking; maxWeight?: number; maxLeverage?: number; startYear?: number };
type SavedPortfolio = { id: string; name: string; description: string; config: SavedConfig; favorite?: boolean; snapshot?: PortfolioSnapshot | null; createdAt?: string };
type LibSort = 'recent' | 'cagr' | 'loading' | 'excess';
type ComputeMeta = { setups: string[]; execution: ExecMode; ladderN: number; parking: Parking; maxWeight?: number; maxLeverage?: number; startYear?: number; synthetic: boolean; syntheticSymbols?: number; truncatedSymbols?: number };

const EXEC_LABEL: Record<ExecMode, string> = { ladder: 'лестница', weekly: 'ребаланс/нед', monthly: 'ребаланс/мес' };
const EXEC_FULL: Record<ExecMode, string> = { ladder: 'Лестница', weekly: 'Недельный ребаланс', monthly: 'Месячный ребаланс' };
const PARK_LABEL: Record<Parking, string> = { BIL: 'BIL (T-bills)', SPY: 'SPY', CASH: 'Кэш (0%)' };
const PARK_SHORT: Record<Parking, string> = { BIL: 'BIL', SPY: 'SPY', CASH: 'кэш' };
const STEPS = ['Вселенная', 'Ребалансировка', 'Параметры', 'Запуск'];

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pf-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

const pct = (x: number | null | undefined, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);
const signPct = (x: number | null | undefined, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%`);
const numFmt = (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(dp));
const signCls = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '' : x > 0 ? 'up' : x < 0 ? 'down' : '');

function fallbackName(setupNames: string[], exec: ExecMode, n: number, parking: Parking, maxWeight: number, maxLeverage = 1, startYear = 0): string {
  const head = setupNames.slice(0, 2).join(' + ') + (setupNames.length > 2 ? ` +${setupNames.length - 2}` : '');
  const ex = exec === 'ladder' ? `лестница ${n}` : exec === 'weekly' ? 'нед. ребаланс' : 'мес. ребаланс';
  const cap = maxWeight > 0 ? ` · потолок ${Math.round(maxWeight * 100)}%` : '';
  const lev = maxLeverage > 1 ? ` · ${maxLeverage}×` : '';
  const yr = startYear > 1990 ? ` · с ${startYear}` : '';
  return `${head} · ${ex} · ${parking}${cap}${lev}${yr}`.slice(0, 63);
}

// Снимок ключевых метрик для списка тестов (сохраняется, чтобы библиотека не пересчитывала).
const snapOf = (m: PortfolioResult['metrics']): PortfolioSnapshot => ({
  cagr: m.cagr, loading: m.loading, excessActive: m.excessActive, sharpe: m.sharpe,
  maxDD: m.maxDD, winRateVsSpy: m.winRateVsSpy, total: m.total, start: m.start, end: m.end,
});

// SVG-кривая капитала: портфель, SPY (buy&hold) и опц. SPY «на загрузке»; годовые метки по оси X.
function EquityChart({ equity, bench, loaded, showLoaded }: { equity: DayPoint[]; bench: DayPoint[]; loaded?: DayPoint[]; showLoaded?: boolean }) {
  const W = 820;
  const H = 240;
  const down = (a: DayPoint[]) => {
    if (a.length <= 420) return a;
    const step = Math.ceil(a.length / 400);
    const out = a.filter((_, i) => i % step === 0);
    if (out[out.length - 1] !== a[a.length - 1]) out.push(a[a.length - 1]);
    return out;
  };
  const eq = down(equity);
  const bm = down(bench);
  const ld = showLoaded && loaded && loaded.length ? down(loaded) : [];
  const vals = [...eq, ...bm, ...ld].map((p) => p.v).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 0.02;
  const minV = lo - pad;
  const maxV = hi + pad;
  const path = (s: DayPoint[]) =>
    s.map((p, i) => {
      const x = (i / (s.length - 1)) * W;
      const y = H - ((p.v - minV) / (maxV - minV)) * H;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  const yOf = (v: number) => H - ((v - minV) / (maxV - minV)) * H;
  const ticks: { x: number; year: string }[] = [];
  for (let i = 1; i < eq.length; i++) {
    const y = eq[i].d.slice(0, 4);
    if (y !== eq[i - 1].d.slice(0, 4)) ticks.push({ x: (i / (eq.length - 1)) * 100, year: y });
  }
  return (
    <div className="pf-eqchart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-testid="portfolio-equity-svg" role="img" aria-label="Кривая капитала портфеля против S&P 500">
        {ticks.map((t) => <line key={t.year} x1={(t.x / 100) * W} y1={0} x2={(t.x / 100) * W} y2={H} stroke="var(--fk-line)" strokeWidth={1} opacity={0.5} />)}
        <line x1={0} y1={yOf(1)} x2={W} y2={yOf(1)} stroke="var(--fk-line)" strokeWidth={1} strokeDasharray="4 4" />
        <path d={path(bm)} fill="none" stroke="var(--fk-text-3)" strokeWidth={1.4} opacity={0.85} />
        {ld.length > 0 && <path d={path(ld)} fill="none" stroke="var(--fk-warn-text, #b5740a)" strokeWidth={1.4} strokeDasharray="5 3" opacity={0.9} />}
        <path d={path(eq)} fill="none" stroke="var(--fk-brand-700, #2563eb)" strokeWidth={1.9} />
      </svg>
      <div className="pf-xaxis" data-testid="pf-xaxis">
        {ticks.map((t) => <span key={t.year} style={{ left: `${t.x}%` }}>{t.year}</span>)}
      </div>
    </div>
  );
}

type Gran = 'year' | 'month' | 'week';
type Period = { key: string; label: string; ret: number; spyRet: number; spyLoadedRet: number; loading: number; days: number; start: string; end: string };
const GRAN_LABEL: Record<Gran, string> = { year: 'Год', month: 'Месяц', week: 'Неделя' };

function periodKey(d: string, g: Gran): { key: string; label: string } {
  if (g === 'year') return { key: d.slice(0, 4), label: d.slice(0, 4) };
  if (g === 'month') return { key: d.slice(0, 7), label: d.slice(0, 7) };
  const ep = Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);
  const wk = Math.floor((ep - 4) / 7); // бакет по понедельникам
  const monday = new Date((wk * 7 + 4) * 86400000).toISOString().slice(0, 10);
  return { key: String(wk), label: monday };
}

// Агрегирует дневные ряды (кривая, бенчмарк, SPY-на-загрузке, загрузка) в периоды выбранной грануляции.
function aggregatePeriods(equity: DayPoint[], bench: DayPoint[], loaded: DayPoint[], loadingByDay: number[], g: Gran): Period[] {
  if (equity.length < 2) return [];
  const out: Period[] = [];
  let a = 0;
  let curKey = periodKey(equity[0].d, g).key;
  const flush = (b: number) => {
    const { key, label } = periodKey(equity[a].d, g);
    const base = a === 0 ? 0 : a - 1; // цепляемся от последнего дня прошлого периода
    const ret = equity[base].v > 0 ? equity[b].v / equity[base].v - 1 : 0;
    const spyRet = bench[base] && bench[base].v > 0 ? bench[b].v / bench[base].v - 1 : 0;
    const spyLoadedRet = loaded[base] && loaded[base].v > 0 ? loaded[b].v / loaded[base].v - 1 : 0;
    let load = 0; // средняя капитальная загрузка периода (0..1), совпадает с headline-метрикой
    let cnt = 0;
    for (let i = Math.max(a, 1); i <= b; i++) { cnt++; load += loadingByDay[i] ?? 0; }
    out.push({ key, label, ret, spyRet, spyLoadedRet, loading: cnt ? load / cnt : 0, days: b - a + 1, start: equity[a].d, end: equity[b].d });
  };
  for (let i = 1; i < equity.length; i++) {
    const k = periodKey(equity[i].d, g).key;
    if (k !== curKey) { flush(i - 1); a = i; curKey = k; }
  }
  flush(equity.length - 1);
  return out;
}

// Интерактивный бар-чарт: доходность стратегии, SPY и опц. SPY-на-загрузке по периодам.
function PeriodChart({ periods, hovered, onHover, showLoaded }: { periods: Period[]; hovered: number; onHover: (i: number) => void; showLoaded?: boolean }) {
  const W = 820;
  const H = 180;
  const mid = H / 2;
  if (!periods.length) return null;
  const maxAbs = Math.max(0.01, ...periods.flatMap((p) => [Math.abs(p.ret), Math.abs(p.spyRet), showLoaded ? Math.abs(p.spyLoadedRet) : 0]));
  const slot = W / periods.length;
  const nBars = showLoaded ? 3 : 2;
  const barW = Math.max(1, Math.min(showLoaded ? 11 : 16, (slot * 0.9) / nBars));
  const bar = (val: number) => {
    const h = (Math.abs(val) / maxAbs) * (mid - 6);
    return { y: val >= 0 ? mid - h : mid, h: Math.max(0.6, h) };
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-testid="pf-period-svg" role="img" aria-label="Доходность по периодам против SPY">
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--fk-line-strong)" strokeWidth={1} />
      {periods.map((p, i) => {
        const cx = i * slot + slot / 2;
        const s = bar(p.ret);
        const b = bar(p.spyRet);
        const l = bar(p.spyLoadedRet);
        const g = barW + 1;
        return (
          <g key={p.key} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(-1)}>
            {hovered === i && <rect x={i * slot} y={0} width={slot} height={H} fill="var(--fk-surface-2)" />}
            {showLoaded ? (
              <>
                <rect x={cx - g - barW / 2} y={s.y} width={barW} height={s.h} rx={1} fill="var(--fk-brand-700, #2563eb)" />
                <rect x={cx - barW / 2} y={b.y} width={barW} height={b.h} rx={1} fill="var(--fk-text-3)" opacity={0.85} />
                <rect x={cx + g - barW / 2} y={l.y} width={barW} height={l.h} rx={1} fill="var(--fk-warn-text, #b5740a)" opacity={0.9} />
              </>
            ) : (
              <>
                <rect x={cx - barW - 0.5} y={s.y} width={barW} height={s.h} rx={1} fill="var(--fk-brand-700, #2563eb)" />
                <rect x={cx + 0.5} y={b.y} width={barW} height={b.h} rx={1} fill="var(--fk-text-3)" opacity={0.85} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const SEG_COLORS = ['#2563eb', '#0a8a60', '#b5740a', '#c81e3c', '#7c3aed', '#0891b2', '#be185d', '#65a30d', '#0d9488', '#9333ea', '#ea580c', '#0369a1'];

// Наглядная долевая полоса состава: ширина сегмента ∝ доля тикера. Опц. хвост — паркинг (SPY/BIL/кэш).
function StackedBar({ positions, parking }: { positions: { symbol: string; weight: number }[]; parking?: { label: string; weight: number } }) {
  const parkW = parking && parking.weight > 1e-4 ? parking.weight * 100 : 0;
  if (!positions.length && !parkW) return <div className="pf-stack empty">в паркинге — позиций нет</div>;
  return (
    <div className="pf-stack" data-testid="pf-stack">
      {positions.map((p, i) => {
        const w = Math.max(0, p.weight * 100);
        return (
          <div key={p.symbol} className="seg" style={{ width: `${w}%`, background: SEG_COLORS[i % SEG_COLORS.length] }} title={`${p.symbol} ${w.toFixed(1)}%`}>
            {w > 7 ? `${p.symbol} ${w.toFixed(0)}%` : ''}
          </div>
        );
      })}
      {parkW > 0 && (
        <div className="seg park" style={{ width: `${parkW}%` }} title={`${parking!.label} (паркинг) ${parkW.toFixed(1)}%`}>
          {parkW > 7 ? `${parking!.label} ${parkW.toFixed(0)}%` : ''}
        </div>
      )}
    </div>
  );
}

export default function PortfoliosPage() {
  const [setups, setSetups] = useState<SetupItem[]>([]);
  const [saved, setSaved] = useState<SavedPortfolio[]>([]);

  const [step, setStep] = useState<number>(0); // 0 — главная (мастер не начат); 1..4 — шаги
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exec, setExec] = useState<ExecMode>('ladder');
  const [ladderN, setLadderN] = useState<number>(5);
  const [parking, setParking] = useState<Parking>('BIL');
  const [maxWeightPct, setMaxWeightPct] = useState<number>(0); // потолок веса на тикер, % (0 = без лимита)
  const [maxLeverage, setMaxLeverage] = useState<number>(1); // макс. плечо (1 = без плеча)
  const [startYear, setStartYear] = useState<number>(0); // год начала бэктеста (0 = с первого сигнала)

  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [meta, setMeta] = useState<ComputeMeta | null>(null);
  const [ran, setRan] = useState(false);
  const [curId, setCurId] = useState<string>('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gran, setGran] = useState<Gran>('year');
  const [hoverP, setHoverP] = useState<number>(-1);
  const [showLoaded, setShowLoaded] = useState(false); // сравнение с SPY «на той же загрузке»
  const [selWeek, setSelWeek] = useState<string | null>(null); // выбранная неделя (drill-down)
  const [selDay, setSelDay] = useState<number>(-1); // индекс выбранного дня (drill-down экспозиции)
  const [dayFilter, setDayFilter] = useState(''); // фильтр дней по тикеру
  const [dayYear, setDayYear] = useState(''); // фильтр ленты дней по году ('' = все)
  const [libQuery, setLibQuery] = useState(''); // поиск по библиотеке тестов
  const [libSort, setLibSort] = useState<LibSort>('recent'); // сортировка библиотеки

  const loadSetups = useCallback(async () => {
    try {
      const r = await fetch('/api/researcher/setups').then((x) => x.json());
      setSetups(Array.isArray(r?.setups) ? r.setups : []);
    } catch {
      setSetups([]);
    }
  }, []);
  const loadSaved = useCallback(async () => {
    try {
      const r = await fetch('/api/researcher/portfolios').then((x) => x.json());
      setSaved(Array.isArray(r?.portfolios) ? r.portfolios : []);
    } catch {
      setSaved([]);
    }
  }, []);
  useEffect(() => {
    loadSetups();
    loadSaved();
  }, [loadSetups, loadSaved]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const newTest = () => {
    setStep(1);
    setSelected(new Set());
    setExec('ladder');
    setLadderN(5);
    setParking('BIL');
    setMaxWeightPct(0);
    setMaxLeverage(1);
    setStartYear(0);
    setResult(null);
    setMeta(null);
    setRan(false);
    setCurId('');
    setName('');
    setErr('');
  };

  // расчёт без автосохранения (используется и мастером, и при открытии сохранённого теста)
  const computeOnly = useCallback(
    async (ids: string[], cfg: { execution: ExecMode; ladderN: number; parking: Parking; maxWeight: number; maxLeverage: number; startYear: number }): Promise<PortfolioResult | null> => {
      const r = await fetch('/api/researcher/portfolios/compute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setupIds: ids, execution: cfg.execution, ladderN: cfg.ladderN, parking: cfg.parking, maxWeight: cfg.maxWeight, maxLeverage: cfg.maxLeverage, startYear: cfg.startYear }),
      }).then((x) => x.json());
      if (r?.error) {
        setErr(String(r.error));
        setResult(null);
        setMeta(null);
        return null;
      }
      setResult(r.result || null);
      setMeta(r.meta || null);
      return r.result || null;
    },
    [],
  );

  // шаг «Запуск»: считаем → автосохраняем с именем от AI (или запасным)
  const run = useCallback(async () => {
    const ids = [...selected];
    if (!ids.length) {
      setErr('Выбери хотя бы один сетап на шаге «Вселенная».');
      setStep(1);
      return;
    }
    setBusy(true);
    setErr('');
    const maxWeight = maxWeightPct > 0 ? Math.min(1, maxWeightPct / 100) : 0;
    try {
      const res = await computeOnly(ids, { execution: exec, ladderN, parking, maxWeight, maxLeverage, startYear });
      if (!res) return;
      setRan(true);
      setStep(0);

      const setupNames = setups.filter((s) => ids.includes(s.id)).map((s) => s.name);
      const m = res.metrics;
      let title = '';
      try {
        const rn = await fetch('/api/researcher/portfolios/suggest-name', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ setups: setupNames, execution: exec, ladderN, parking, maxWeight, maxLeverage, startYear, metrics: { cagr: m.cagr, loading: m.loading, excessTotal: m.excessTotal, sharpe: m.sharpe } }),
        }).then((x) => x.json());
        if (rn?.title) title = String(rn.title);
      } catch {
        /* graceful — запасное имя ниже */
      }
      if (!title) title = fallbackName(setupNames, exec, ladderN, parking, maxWeight, maxLeverage, startYear);
      const id = newId();
      setName(title);
      setCurId(id);
      try {
        await fetch('/api/researcher/portfolios', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, name: title, config: { setupIds: ids, selection: 'all', execution: exec, ladderN, parking, maxWeight, maxLeverage, startYear }, snapshot: snapOf(m) }),
        });
        await loadSaved();
      } catch {
        /* graceful */
      }
    } catch (e: any) {
      setErr(e?.message || 'Ошибка расчёта');
    } finally {
      setBusy(false);
    }
  }, [selected, exec, ladderN, parking, maxWeightPct, maxLeverage, startYear, setups, computeOnly, loadSaved]);

  // переименование текущего теста (сохранённого)
  const rename = useCallback(
    async (nm: string) => {
      setName(nm);
      if (!curId || !nm.trim()) return;
      try {
        const maxWeight = maxWeightPct > 0 ? Math.min(1, maxWeightPct / 100) : 0;
        await fetch('/api/researcher/portfolios', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: curId, name: nm.trim(), config: { setupIds: [...selected], selection: 'all', execution: exec, ladderN, parking, maxWeight, maxLeverage, startYear } }),
        });
        await loadSaved();
      } catch {
        /* graceful */
      }
    },
    [curId, selected, exec, ladderN, parking, maxWeightPct, maxLeverage, startYear, loadSaved],
  );

  const openSaved = useCallback(
    async (p: SavedPortfolio) => {
      const ids = p.config.setupIds || [];
      const mw = p.config.maxWeight ?? 0;
      const lev = p.config.maxLeverage ?? 1;
      const sy = p.config.startYear ?? 0;
      setSelected(new Set(ids));
      setExec(p.config.execution);
      setLadderN(p.config.ladderN ?? 5);
      setParking(p.config.parking);
      setMaxWeightPct(mw > 0 ? Math.round(mw * 100) : 0);
      setMaxLeverage(lev > 1 ? lev : 1);
      setStartYear(sy > 1990 ? sy : 0);
      setCurId(p.id);
      setName(p.name);
      setStep(0);
      setErr('');
      setBusy(true);
      try {
        const res = await computeOnly(ids, { execution: p.config.execution, ladderN: p.config.ladderN ?? 5, parking: p.config.parking, maxWeight: mw, maxLeverage: lev, startYear: sy });
        setRan(true);
        // освежаем снимок метрик в библиотеке (в т.ч. для старых тестов без него)
        if (res?.metrics) {
          fetch('/api/researcher/portfolios', {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: p.id, snapshot: snapOf(res.metrics) }),
          }).then(() => loadSaved()).catch(() => {});
        }
      } finally {
        setBusy(false);
      }
    },
    [computeOnly, loadSaved],
  );

  // избранное: закреплённые тесты выводятся выше и выделены
  const toggleFavorite = useCallback(
    async (id: string, favorite: boolean) => {
      setSaved((prev) => prev.map((p) => (p.id === id ? { ...p, favorite } : p))); // оптимистично
      try {
        await fetch('/api/researcher/portfolios', {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, favorite }),
        });
        await loadSaved();
      } catch {
        /* graceful */
      }
    },
    [loadSaved],
  );

  const removeSaved = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/researcher/portfolios?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadSaved();
        if (id === curId) {
          setRan(false);
          setResult(null);
        }
      } catch {
        /* graceful */
      }
    },
    [loadSaved, curId],
  );

  // быстрый пересчёт открытого теста с текущими параметрами (без мастера) + обновление сохранённого
  const recompute = useCallback(async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    setErr('');
    const maxWeight = maxWeightPct > 0 ? Math.min(1, maxWeightPct / 100) : 0;
    try {
      const res = await computeOnly(ids, { execution: exec, ladderN, parking, maxWeight, maxLeverage, startYear });
      if (res && curId) {
        await fetch('/api/researcher/portfolios', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: curId, name: name || fallbackName(setups.filter((s) => ids.includes(s.id)).map((s) => s.name), exec, ladderN, parking, maxWeight, maxLeverage, startYear), config: { setupIds: ids, selection: 'all', execution: exec, ladderN, parking, maxWeight, maxLeverage, startYear }, snapshot: snapOf(res.metrics) }),
        });
        await loadSaved();
      }
    } catch (e: any) {
      setErr(e?.message || 'Ошибка расчёта');
    } finally {
      setBusy(false);
    }
  }, [selected, exec, ladderN, parking, maxWeightPct, maxLeverage, startYear, curId, name, setups, computeOnly, loadSaved]);

  const m = result?.metrics;
  const parkShort = PARK_SHORT[(meta?.parking ?? parking) as Parking] || 'паркинг';
  const stats = useMemo(() => {
    if (!m) return [];
    return [
      { k: 'Загрузка (капитал)', v: pct(m.loading, 1), sub: `${parking === 'SPY' ? 'SPY-паркинг = в рынке · ' : ''}в позициях ${pct(m.timeInMarket, 0)} дней (${m.inMarketDays}/${Math.max(0, m.days - 1)})`, cls: '' },
      { k: 'Годовая (CAGR)', v: signPct(m.cagr), sub: `всего ${signPct(m.total)}`, cls: signCls(m.cagr) },
      { k: 'Макс. просадка', v: pct(m.maxDD), sub: `SPY ${pct(m.spyMaxDD)}`, cls: 'down' },
      { k: 'Sharpe (всего)', v: numFmt(m.sharpe), sub: `SPY ${numFmt(m.spySharpe)}`, cls: signCls(m.sharpe) },
      { k: 'Превышение vs SPY (нагр.)', v: signPct(m.excessActive), sub: `рукав ${signPct(m.activeTotal)} / SPY(нагр) ${signPct(m.spyActiveTotal)}`, cls: signCls(m.excessActive) },
      { k: 'Sharpe (нагр.)', v: numFmt(m.sharpeActive), sub: `SPY(нагр) ${numFmt(m.spySharpeActive)}`, cls: signCls(m.sharpeActive) },
      { k: 'Sharpe к SPY (нагр.)', v: m.sharpeVsSpyActive == null ? '—' : `${numFmt(m.sharpeVsSpyActive)}×`, sub: `всего ${m.sharpeVsSpy == null ? '—' : numFmt(m.sharpeVsSpy) + '×'}`, cls: signCls((m.sharpeVsSpyActive ?? 1) - 1) },
      { k: 'Доходность / загрузка', v: signPct(m.returnOnLoading), sub: 'CAGR ÷ загрузка', cls: signCls(m.returnOnLoading) },
      { k: 'Win-rate vs SPY', v: m.winRateVsSpy == null ? '—' : pct(m.winRateVsSpy, 0), sub: `${m.winTrades}/${m.totalTrades} сделок обогнали SPY`, cls: signCls((m.winRateVsSpy ?? 0.5) - 0.5) },
    ];
  }, [m, parking]);

  const periods = useMemo(
    () => (result && result.equity.length > 1 ? aggregatePeriods(result.equity, result.benchEquity, result.benchLoadedEquity, result.loadingByDay, gran) : []),
    [result, gran],
  );
  const hp = hoverP >= 0 && hoverP < periods.length ? periods[hoverP] : null;
  const weekDetail = useMemo(() => (result && selWeek ? result.weeks.find((w) => w.start === selWeek) || null : null), [result, selWeek]);
  useEffect(() => { setSelWeek(null); }, [result, gran]);

  // посуточная экспозиция и сделки: список (новые сверху) с фильтром по году и тикеру
  const dayYears = useMemo(() => {
    const ys = new Set<string>();
    for (const d of result?.days || []) ys.add(d.date.slice(0, 4));
    return [...ys].sort((a, b) => (a < b ? 1 : -1)); // новые годы сверху
  }, [result]);
  const dayList = useMemo(() => {
    const all = result?.days ? result.days.map((d, idx) => ({ d, idx })).reverse() : [];
    const f = dayFilter.trim().toUpperCase();
    return all.filter(({ d }) => {
      if (dayYear && d.date.slice(0, 4) !== dayYear) return false;
      if (f && !(d.positions.some((p) => p.symbol.includes(f)) || d.bought.some((t) => t.symbol.includes(f)) || d.sold.some((t) => t.symbol.includes(f)))) return false;
      return true;
    });
  }, [result, dayFilter, dayYear]);
  const selDayEvent = useMemo(() => (result?.days && selDay >= 0 ? result.days[selDay] || null : null), [result, selDay]);
  useEffect(() => { setSelDay(-1); setDayFilter(''); setDayYear(''); }, [result]);

  // библиотека тестов: поиск по имени + сортировка; избранные всегда закреплены сверху
  const libRows = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    const filtered = saved.filter((p) => !q || p.name.toLowerCase().includes(q));
    const metricKey = (p: SavedPortfolio): number => {
      const s = p.snapshot || {};
      if (libSort === 'cagr') return s.cagr ?? -Infinity;
      if (libSort === 'loading') return s.loading ?? -Infinity;
      if (libSort === 'excess') return s.excessActive ?? -Infinity;
      return 0;
    };
    return [...filtered].sort((a, b) => {
      const fav = Number(!!b.favorite) - Number(!!a.favorite);
      if (fav) return fav; // избранные сверху
      if (libSort === 'recent') return 0; // серверный порядок (updated_at desc)
      return metricKey(b) - metricKey(a);
    });
  }, [saved, libQuery, libSort]);
  const favCount = useMemo(() => saved.filter((p) => p.favorite).length, [saved]);

  const canNext = step === 1 ? selected.size > 0 : true;
  const selectedNames = setups.filter((s) => selected.has(s.id)).map((s) => s.name);

  return (
    <main className="rsx pf">
      <div className="top">
        <h1>Портфели</h1>
        <span className="sub">Тесты стратегий из сетапов: загрузка, доходность/альфа на загрузку, Sharpe и просадка против S&amp;P 500</span>
      </div>

      {setups.length === 0 ? (
        <div className="card"><div className="card-b">
          <div className="pf-empty" data-testid="pf-empty">
            Пока нет сетапов. Сохрани находки в разделе <a href="/researcher">Скринер</a> (вселенная + условия + цифры → «кирпичик»),
            затем собери из них тест здесь.
          </div>
        </div></div>
      ) : (
        <>
          {/* Главная: сохранённые тесты + «Новый тест» */}
          {step === 0 && (
            <div className="card"><div className="card-b">
              <div className="pf-lib-head">
                <div className="card-t">Тесты ({saved.length}{favCount > 0 ? `, ★ ${favCount}` : ''})</div>
                <div className="pf-lib-tools">
                  <button className="btn apply on" data-testid="new-test" onClick={newTest}>➕ Новый тест</button>
                  <input className="nin" placeholder="Поиск по имени…" data-testid="pf-lib-search" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} />
                  <div className="seg pf-sort" data-testid="pf-lib-sort">
                    {([['recent', 'Свежие'], ['cagr', 'CAGR'], ['loading', 'Загрузка'], ['excess', 'vs SPY']] as [LibSort, string][]).map(([k, l]) => (
                      <button key={k} className={libSort === k ? 'on' : ''} onClick={() => setLibSort(k)}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              {saved.length === 0 ? (
                <div className="pf-empty" data-testid="pf-lib-empty">Сохранённых тестов пока нет — создай новый через «➕ Новый тест». После запуска тест сохранится сюда автоматически.</div>
              ) : (
                <div className="pf-ptable-wrap" style={{ maxHeight: 460 }}>
                  <table className="pf-ptable pf-lib" data-testid="pf-lib-table">
                    <thead><tr>
                      <th></th><th className="l">Название</th><th>CAGR</th><th>Загрузка</th><th>vs SPY (нагр.)</th>
                      <th>Sharpe</th><th>Просадка</th><th>Win</th><th className="l">Механика</th><th>Создан</th><th></th>
                    </tr></thead>
                    <tbody>
                      {libRows.map((p) => {
                        const s = p.snapshot || {};
                        const cfgSum = `${EXEC_LABEL[p.config.execution]}${p.config.execution === 'ladder' ? ` N=${p.config.ladderN}` : ''} · ${p.config.parking}${(p.config.maxWeight ?? 0) > 0 ? ` · ≤${Math.round((p.config.maxWeight as number) * 100)}%` : ''}`;
                        return (
                          <tr key={p.id} data-testid="portfolio-chip" className={`click${p.favorite ? ' fav' : ''}${p.id === curId ? ' sel' : ''}`} onClick={() => openSaved(p)}>
                            <td className="pf-star" data-testid="portfolio-fav" onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id, !p.favorite); }} title={p.favorite ? 'Убрать из избранного' : 'В избранное'}>{p.favorite ? '★' : '☆'}</td>
                            <td className="l sy">{p.name}</td>
                            <td className={signCls(s.cagr)}>{signPct(s.cagr)}</td>
                            <td>{pct(s.loading, 0)}</td>
                            <td className={signCls(s.excessActive)}>{signPct(s.excessActive)}</td>
                            <td>{numFmt(s.sharpe)}</td>
                            <td className="down">{pct(s.maxDD)}</td>
                            <td>{s.winRateVsSpy == null ? '—' : pct(s.winRateVsSpy, 0)}</td>
                            <td className="l">{cfgSum}</td>
                            <td>{(p.createdAt || '').slice(0, 10) || '—'}</td>
                            <td className="bx" data-testid="portfolio-chip-del" onClick={(e) => { e.stopPropagation(); removeSaved(p.id); }}>✕</td>
                          </tr>
                        );
                      })}
                      {!libRows.length && <tr><td className="l" colSpan={11}>ничего не найдено по «{libQuery}»</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div></div>
          )}

          {/* Мастер */}
          {step >= 1 && (
            <div className="card"><div className="card-b">
              <div className="pf-steps" data-testid="pf-steps">
                {STEPS.map((s, i) => {
                  const n = i + 1;
                  return (
                    <span key={s} className={`pf-step${n === step ? ' on' : n < step ? ' done' : ''}`}>
                      <span className="num">{n < step ? '✓' : n}</span>{s}
                      {i < STEPS.length - 1 && <span className="sep">→</span>}
                    </span>
                  );
                })}
              </div>

              <div className="pf-wiz-body">
                {step === 1 && (
                  <>
                    <div className="card-t" style={{ marginBottom: 8 }}>Вселенная — выбери сетапы ({selected.size})</div>
                    <div className="grp" data-testid="pf-setup-pick">
                      {setups.map((s) => {
                        const on = selected.has(s.id);
                        const sg = Number(s.snapshot?.n);
                        return (
                          <span key={s.id} className={`chip pick${on ? ' on' : ''}`} data-testid="setup-pick-chip" onClick={() => toggle(s.id)}>
                            {s.name}{Number.isFinite(sg) && <span className="m">{sg} сд.</span>}
                          </span>
                        );
                      })}
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="card-t" style={{ marginBottom: 8 }}>Ребалансировка — как держим и перекладываемся</div>
                    <div className="pf-controls" style={{ marginTop: 0 }}>
                      <div className="ctl">
                        <span className="lbl">Исполнение</span>
                        <select value={exec} data-testid="pf-exec" onChange={(e) => setExec(e.target.value as ExecMode)}>
                          <option value="ladder">Лестница (N дней)</option>
                          <option value="weekly">Ребаланс / неделя</option>
                          <option value="monthly">Ребаланс / месяц</option>
                        </select>
                        {exec === 'ladder' && (
                          <input className="kin" type="number" min={1} max={60} value={ladderN} data-testid="pf-ladderN"
                            onChange={(e) => setLadderN(Math.max(1, Math.min(60, Number(e.target.value) || 5)))} />
                        )}
                      </div>
                    </div>
                    <div className="pf-note" style={{ marginTop: 10 }}>
                      Лестница — N параллельных под-портфелей, сдвинутых по фазе на день: каждый день один под-портфель (1/N капитала)
                      перекладывается в текущий отбор (имена с сигналом за трейлинг-окно N дней) и держит N дней. Залп сигналов подхватывается
                      N входами подряд → загрузка плавно набирается к 100% и плавно снимается. Недельный/месячный — 100% ребаланс в имена
                      с сигналом за период. Срок удержания задаёт исполнение, не горизонт сетапа.
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div className="card-t" style={{ marginBottom: 8 }}>Параметры — паркинг, потолок на тикер, вес, отбор</div>
                    <div className="pf-controls" style={{ marginTop: 0 }}>
                      <div className="ctl">
                        <span className="lbl">Паркинг простоя</span>
                        <select value={parking} data-testid="pf-parking" onChange={(e) => setParking(e.target.value as Parking)}>
                          <option value="BIL">BIL (T-bills)</option>
                          <option value="SPY">SPY</option>
                          <option value="CASH">Кэш (0%)</option>
                        </select>
                      </div>
                      <div className="ctl">
                        <span className="lbl">Потолок на тикер</span>
                        <input className="kin" type="number" min={0} max={100} step={5} value={maxWeightPct} data-testid="pf-maxweight"
                          onChange={(e) => setMaxWeightPct(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))} />
                        <span className="lbl" style={{ textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>% (0 = без лимита)</span>
                      </div>
                      <div className="ctl">
                        <span className="lbl">Макс плечо</span>
                        <select value={maxLeverage} data-testid="pf-leverage" onChange={(e) => setMaxLeverage(Number(e.target.value))}>
                          <option value={1}>1× (без плеча)</option>
                          <option value={1.25}>1.25×</option>
                          <option value={1.5}>1.5×</option>
                          <option value={1.75}>1.75×</option>
                          <option value={2}>2×</option>
                          <option value={2.5}>2.5×</option>
                          <option value={3}>3×</option>
                        </select>
                      </div>
                      <div className="ctl">
                        <span className="lbl">Год начала</span>
                        <input className="kin" type="number" min={0} max={2100} step={1} value={startYear || ''} placeholder="с начала" data-testid="pf-startyear"
                          onChange={(e) => setStartYear(Math.max(0, Math.min(2100, Math.floor(Number(e.target.value)) || 0)))} />
                      </div>
                      <div className="ctl"><span className="lbl">Вес · отбор</span><span className="badge">равный · все имена</span></div>
                    </div>
                    <div className="pf-note" style={{ marginTop: 10 }}>
                      Потолок на тикер ограничивает долю одного имени; если имён мало и равный вес превысил бы потолок, остаток уходит в паркинг.
                      Плечо (напр. 1.5×) даёт долю на имя <b>min(плечо/N, потолок)</b> — суммарно &gt;100% набирается только когда имён достаточно
                      («позиций много»). Простаивающий капитал паркуется как выбрано (SPY/BIL/кэш), а заёмная часть (сверх 100%) финансируется по
                      безрисковой ставке (BIL). Год начала — с какого года гнать бэктест (пусто = с первого сигнала). Отбор — «все имена». Оценка in-sample.
                    </div>
                  </>
                )}

                {step === 4 && (
                  <>
                    <div className="card-t" style={{ marginBottom: 8 }}>Запуск — проверь и посчитай</div>
                    <div className="pf-summary">
                      <div className="row"><span className="k">Сетапы ({selectedNames.length})</span><span>{selectedNames.join(', ') || '—'}</span></div>
                      <div className="row"><span className="k">Исполнение</span><span>{EXEC_FULL[exec]}{exec === 'ladder' ? ` · N=${ladderN}` : ''}</span></div>
                      <div className="row"><span className="k">Потолок на тикер</span><span>{maxWeightPct > 0 ? `${maxWeightPct}% (остаток → паркинг)` : 'без лимита'}</span></div>
                      <div className="row"><span className="k">Макс плечо</span><span>{maxLeverage > 1 ? `${maxLeverage}× (простой → паркинг; заём сверх 100% — по ставке BIL)` : 'без плеча'}</span></div>
                      <div className="row"><span className="k">Год начала</span><span>{startYear > 1990 ? startYear : 'с первого сигнала'}</span></div>
                      <div className="row"><span className="k">Паркинг · вес · отбор</span><span>{PARK_LABEL[parking]} · равный · все имена</span></div>
                    </div>
                    <div className="pf-note" style={{ marginTop: 10 }}>После запуска тест автоматически сохранится с названием от AI (его можно изменить).</div>
                  </>
                )}
              </div>

              {err && <div className="pf-err" data-testid="pf-err">{err}</div>}

              <div className="pf-wiz-nav">
                <button className="btn" data-testid="wizard-back" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || busy}>← Назад</button>
                <button className="btn" onClick={() => { setStep(0); setErr(''); }} disabled={busy}>Отмена</button>
                <div className="spacer" />
                {step < 4 ? (
                  <button className={`btn apply${canNext ? ' on' : ''}`} data-testid="wizard-next" onClick={() => canNext && setStep((s) => Math.min(4, s + 1))} disabled={!canNext || busy}>Далее →</button>
                ) : (
                  <button className="btn apply on" data-testid="wizard-run" onClick={run} disabled={busy}>{busy ? 'Считаю…' : 'Запустить'}</button>
                )}
              </div>
            </div></div>
          )}

          {/* Результаты */}
          {ran && m && (
            <div className="card"><div className="card-b">
              <div className="pf-name">
                <input data-testid="portfolio-name" value={name} placeholder="Название теста…" onChange={(e) => setName(e.target.value)} onBlur={(e) => rename(e.target.value)} />
                <button className="btn sm" data-testid="new-test-2" onClick={newTest}>➕ Новый тест</button>
              </div>
              {/* быстрая правка параметров + пересчёт без мастера */}
              <div className="pf-controls pf-recompute" data-testid="pf-recompute">
                <div className="ctl">
                  <span className="lbl">Исполнение</span>
                  <select value={exec} data-testid="pf-rc-exec" onChange={(e) => setExec(e.target.value as ExecMode)}>
                    <option value="ladder">Лестница</option>
                    <option value="weekly">Ребаланс / неделя</option>
                    <option value="monthly">Ребаланс / месяц</option>
                  </select>
                  {exec === 'ladder' && (
                    <input className="kin" type="number" min={1} max={60} value={ladderN} data-testid="pf-rc-ladderN"
                      onChange={(e) => setLadderN(Math.max(1, Math.min(60, Number(e.target.value) || 5)))} />
                  )}
                </div>
                <div className="ctl">
                  <span className="lbl">Паркинг</span>
                  <select value={parking} data-testid="pf-rc-parking" onChange={(e) => setParking(e.target.value as Parking)}>
                    <option value="BIL">BIL</option><option value="SPY">SPY</option><option value="CASH">Кэш</option>
                  </select>
                </div>
                <div className="ctl">
                  <span className="lbl">Потолок %</span>
                  <input className="kin" type="number" min={0} max={100} step={5} value={maxWeightPct} data-testid="pf-rc-maxweight"
                    onChange={(e) => setMaxWeightPct(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))} />
                </div>
                <div className="ctl">
                  <span className="lbl">Плечо</span>
                  <select value={maxLeverage} data-testid="pf-rc-leverage" onChange={(e) => setMaxLeverage(Number(e.target.value))}>
                    <option value={1}>1×</option>
                    <option value={1.25}>1.25×</option>
                    <option value={1.5}>1.5×</option>
                    <option value={1.75}>1.75×</option>
                    <option value={2}>2×</option>
                    <option value={2.5}>2.5×</option>
                    <option value={3}>3×</option>
                  </select>
                </div>
                <div className="ctl">
                  <span className="lbl">С года</span>
                  <input className="kin" type="number" min={0} max={2100} step={1} value={startYear || ''} placeholder="нач." data-testid="pf-rc-startyear"
                    onChange={(e) => setStartYear(Math.max(0, Math.min(2100, Math.floor(Number(e.target.value)) || 0)))} />
                </div>
                <div className="grow">
                  <button className="btn apply on" data-testid="pf-recompute-run" onClick={recompute} disabled={busy}>{busy ? 'Считаю…' : '↻ Пересчитать'}</button>
                </div>
              </div>
              <div className="card-t">Метрики стратегии</div>
              <div className="statgrid pf" data-testid="portfolio-metrics" style={{ marginTop: 10 }}>
                {stats.map((s) => (
                  <div className="stat" key={s.k}>
                    <div className="k">{s.k}</div>
                    <div className={`v ${s.cls}`}>{s.v}</div>
                    <div className="sub">{s.sub}</div>
                  </div>
                ))}
              </div>
              <div className="pf-note" data-testid="portfolio-meta">
                Период {m.start ?? '—'}…{m.end ?? '—'} · {m.nSignals} сигналов · {m.nSymbols} имён · {m.nSetups} сетапов ·{' '}
                {EXEC_LABEL[meta?.execution ?? exec]}{(meta?.execution ?? exec) === 'ladder' ? ` N=${meta?.ladderN ?? ladderN}` : ''} · паркинг {meta?.parking ?? parking}
                {(meta?.maxWeight ?? 0) > 0 ? ` · потолок ${Math.round((meta!.maxWeight as number) * 100)}%` : ''}
                {(meta?.maxLeverage ?? 1) > 1 ? ` · плечо ${meta!.maxLeverage}×` : ''}
                {(meta?.startYear ?? 0) > 1990 ? ` · с ${meta!.startYear}` : ''}
                {meta?.synthetic && <span className="badge warn" style={{ marginLeft: 8 }}>данные синтетические (без ключей)</span>}
                {!meta?.synthetic && !!meta?.syntheticSymbols && <span className="badge warn" style={{ marginLeft: 8 }}>имён без реальных цен: {meta.syntheticSymbols} (синтетика)</span>}
                {!!meta?.truncatedSymbols && <span className="badge warn" style={{ marginLeft: 8 }}>усечено имён: {meta.truncatedSymbols}</span>}
              </div>
              <div className="pf-note">
                Метрики «(нагр.)» считаются ТОЛЬКО за дни, когда стратегия держит реальные позиции сетапов, и сравниваются с SPY ровно за
                те же дни (активный рукав): это корректное «на нагрузку». Альфа на нагрузку = превышение рукава над SPY за дни нагрузки.
                Загрузка (капитал) — средняя доля капитала под рыночным риском: <b>BIL/кэш</b> в паркинге не считаются загрузкой, а <b>SPY</b> в
                паркинге считается (капитал в рынке → загрузка ≈ 100%). «Доходность/загрузка» = CAGR ÷ загрузка — интенсивность, не достижимая
                доходность. Оценка in-sample.
              </div>

              {result && result.equity.length > 1 && (
                <>
                  <div className="card-t" style={{ marginTop: 14 }}>Кривая капитала (сложный процент)</div>
                  <div className="pf-chart" data-testid="portfolio-equity">
                    <EquityChart equity={result.equity} bench={result.benchEquity} loaded={result.benchLoadedEquity} showLoaded={showLoaded} />
                  </div>
                  <div className="pf-legend">
                    <span><i style={{ background: 'var(--fk-brand-700, #2563eb)' }} />Портфель</span>
                    <span><i style={{ background: 'var(--fk-text-3)' }} />S&amp;P 500 (SPY, buy &amp; hold)</span>
                    {showLoaded && <span><i style={{ background: 'var(--fk-warn-text, #b5740a)' }} />SPY на загрузке</span>}
                  </div>
                </>
              )}
            </div></div>
          )}

          {/* Доходность и загрузка по периодам (интерактивно, с бенчмарком) */}
          {ran && periods.length > 0 && (
            <div className="card"><div className="card-b">
              <div className="pf-period-head">
                <div className="card-t">Доходность и загрузка по периодам</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <label className="pf-toggle" data-testid="pf-loaded-toggle">
                    <input type="checkbox" checked={showLoaded} onChange={(e) => setShowLoaded(e.target.checked)} /> SPY на загрузке
                  </label>
                  <div className="seg pf-gran" data-testid="pf-gran">
                    {(['year', 'month', 'week'] as Gran[]).map((g) => (
                      <button key={g} className={gran === g ? 'on' : ''} onClick={() => { setGran(g); setHoverP(-1); }}>{GRAN_LABEL[g]}</button>
                    ))}
                  </div>
                </div>
              </div>
              {hp ? (
                <div className="pf-period-sel" data-testid="pf-period-sel">
                  <b>{hp.label}</b> · стратегия <span className={signCls(hp.ret)}>{signPct(hp.ret)}</span> · SPY {signPct(hp.spyRet)}
                  {showLoaded && <> · SPY(загр) {signPct(hp.spyLoadedRet)}</>} · превышение{' '}
                  <span className={signCls(hp.ret - hp.spyRet)}>{signPct(hp.ret - hp.spyRet)}</span> · загрузка {pct(hp.loading, 0)}
                </div>
              ) : (
                <div className="pf-period-sel muted">наведи на столбец — доходность периода, сравнение с SPY и загрузка</div>
              )}
              <div className="pf-chart">
                <PeriodChart periods={periods} hovered={hoverP} onHover={setHoverP} showLoaded={showLoaded} />
              </div>
              <div className="pf-legend">
                <span><i style={{ background: 'var(--fk-brand-700, #2563eb)' }} />Портфель</span>
                <span><i style={{ background: 'var(--fk-text-3)' }} />S&amp;P 500</span>
                {showLoaded && <span><i style={{ background: 'var(--fk-warn-text, #b5740a)' }} />SPY на загрузке</span>}
              </div>

              <div className="pf-ptable-wrap">
                <table className="pf-ptable" data-testid="pf-period-table">
                  <thead><tr><th className="l">Период</th><th>Стратегия</th><th>SPY</th>{showLoaded && <th>SPY (загр)</th>}<th>Превышение</th><th>Загрузка</th></tr></thead>
                  <tbody>
                    {periods.slice(-120).reverse().map((p, i) => {
                      const realIdx = periods.length - 1 - i;
                      return (
                        <tr key={p.key} data-testid={gran === 'week' ? 'pf-week-row' : undefined}
                          className={`click${realIdx === hoverP ? ' on' : ''}${gran === 'week' && selWeek === p.label ? ' sel' : ''}`}
                          onMouseEnter={() => setHoverP(realIdx)} onMouseLeave={() => setHoverP(-1)}
                          onClick={() => gran === 'week' && setSelWeek(p.label)}>
                          <td className="l">{p.label}{gran === 'week' && <span className="pf-drill"> ↳</span>}</td>
                          <td className={signCls(p.ret)}>{signPct(p.ret)}</td>
                          <td>{signPct(p.spyRet)}</td>
                          {showLoaded && <td>{signPct(p.spyLoadedRet)}</td>}
                          <td className={signCls(p.ret - p.spyRet)}>{signPct(p.ret - p.spyRet)}</td>
                          <td>{pct(p.loading, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {periods.length > 120 && <div className="pf-note">Показаны последние 120 периодов из {periods.length}.</div>}
              {gran === 'week' && <div className="pf-note">Грануляция «Неделя»: кликни строку ↳ — состав недели, экспозиция по именам и причина (сетапы).</div>}
            </div></div>
          )}

          {/* Drill-down недели: что держалось, экспозиция в %, причины */}
          {ran && gran === 'week' && weekDetail && (
            <div className="card"><div className="card-b">
              <div className="pf-period-head">
                <div className="card-t">Неделя {weekDetail.start} — состав и причины</div>
                <button className="btn sm" data-testid="pf-week-close" onClick={() => setSelWeek(null)}>✕ закрыть</button>
              </div>
              <div className="pf-week-meta" data-testid="pf-week-meta">
                доходность <span className={signCls(weekDetail.ret)}>{signPct(weekDetail.ret)}</span> · SPY {signPct(weekDetail.spyRet)} · загрузка {pct(weekDetail.loading, 0)} · в паркинге {pct(weekDetail.parkingShare, 0)}
              </div>
              {weekDetail.setupsActive.length > 0 && (
                <div className="pf-note">Причина экспозиции — активные сигналы сетапов: <b>{weekDetail.setupsActive.join(', ')}</b>.</div>
              )}
              <div className="pf-ptable-wrap" style={{ marginTop: 10 }}>
                <table className="pf-ptable" data-testid="pf-week-positions">
                  <thead><tr><th className="l">Тикер</th><th>Экспозиция</th><th>Дней</th><th className="l">Сетапы</th></tr></thead>
                  <tbody>
                    {weekDetail.positions.map((p) => (
                      <tr key={p.symbol}>
                        <td className="l sy">{p.symbol}</td>
                        <td>{pct(p.weight, 1)}</td>
                        <td>{p.days}</td>
                        <td className="l">{p.setups.join(', ')}</td>
                      </tr>
                    ))}
                    {!weekDetail.positions.length && <tr><td className="l" colSpan={4}>всю неделю в паркинге — позиций нет</td></tr>}
                  </tbody>
                </table>
              </div>
            </div></div>
          )}

          {/* Экспозиция и сделки по дням: полная реальная экспозиция каждого дня + что куплено/продано */}
          {ran && result && result.days.length > 0 && (
            <div className="card"><div className="card-b">
              <div className="pf-period-head">
                <div className="card-t">Экспозиция и сделки по дням ({result.days.length})</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {dayYears.length > 1 && (
                    <select className="nin" style={{ width: 'auto' }} data-testid="pf-day-year" value={dayYear} onChange={(e) => setDayYear(e.target.value)}>
                      <option value="">Все годы</option>
                      {dayYears.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  )}
                  <input className="nin" placeholder="Фильтр по тикеру…" data-testid="pf-reb-filter" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} />
                </div>
              </div>
              {selDayEvent ? (
                <>
                  <div className="pf-week-meta" data-testid="pf-reb-sel">
                    <b>{selDayEvent.date}</b> · экспозиция {pct(selDayEvent.deployment, 0)} · паркинг {pct(selDayEvent.parking, 0)} · имён {selDayEvent.positions.length}
                    {' '}· день <span className={signCls(selDayEvent.ret)}>{signPct(selDayEvent.ret)}</span> · SPY {signPct(selDayEvent.spyRet)}
                  </div>
                  <StackedBar positions={selDayEvent.positions} parking={{ label: parkShort, weight: selDayEvent.parking }} />
                  <div className="pf-ptable-wrap" style={{ marginTop: 10, maxHeight: 220 }}>
                    <table className="pf-ptable" data-testid="pf-reb-positions">
                      <thead><tr><th className="l">Тикер</th><th>Экспозиция</th><th className="l">Сетапы</th></tr></thead>
                      <tbody>
                        {selDayEvent.positions.map((p) => (<tr key={p.symbol}><td className="l sy">{p.symbol}</td><td>{pct(p.weight, 1)}</td><td className="l">{(result.symSetups[p.symbol] || []).join(', ')}</td></tr>))}
                        {!selDayEvent.positions.length && <tr><td className="l" colSpan={3}>в паркинге — позиций нет</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  {(selDayEvent.bought.length > 0 || selDayEvent.sold.length > 0) && (
                    <div className="pf-trades" data-testid="pf-day-trades">
                      <div className="tr-col"><span className="tr-h buy">Куплено сегодня</span>{selDayEvent.bought.length ? selDayEvent.bought.map((t) => <span key={t.symbol} className="tr-item">{t.symbol} <b>{pct(t.weight, 1)}</b></span>) : <span className="muted">—</span>}</div>
                      <div className="tr-col"><span className="tr-h sell">Продано сегодня</span>{selDayEvent.sold.length ? selDayEvent.sold.map((t) => <span key={t.symbol} className="tr-item">{t.symbol} <b>{pct(t.weight, 1)}</b></span>) : <span className="muted">—</span>}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="pf-period-sel muted">кликни день ниже — полная экспозиция дня и что куплено/продано. Лестница = каждый день один из N под-портфелей (1/N капитала) перекладывается в текущий отбор.</div>
              )}
              <div className="pf-ptable-wrap" style={{ marginTop: 12 }}>
                <table className="pf-ptable" data-testid="pf-reb-table">
                  <thead><tr><th className="l">Дата</th><th>Экспозиция</th><th>Имён</th><th>Сделки</th><th>День</th><th>vs SPY</th><th className="l">Состав (доли)</th></tr></thead>
                  <tbody>
                    {dayList.slice(0, 400).map(({ d, idx }) => (
                      <tr key={idx} data-testid="pf-reb-row" className={`click${idx === selDay ? ' sel' : ''}`} onClick={() => setSelDay(idx)}>
                        <td className="l">{d.date}</td>
                        <td>{pct(d.deployment, 0)}</td>
                        <td>{d.positions.length}</td>
                        <td>{d.bought.length + d.sold.length > 0 ? `${d.bought.length}↑ ${d.sold.length}↓` : '—'}</td>
                        <td className={signCls(d.ret)}>{signPct(d.ret)}</td>
                        <td className={signCls(d.ret - d.spyRet)}>{signPct(d.ret - d.spyRet)}</td>
                        <td className="l" style={{ minWidth: 200 }}><StackedBar positions={d.positions.slice(0, 12)} parking={{ label: parkShort, weight: d.parking }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dayList.length > 400 && <div className="pf-note">Показаны первые 400 из {dayList.length} дней{dayYear ? ` за ${dayYear}` : ''}. Уточни выбором года или фильтром по тикеру.</div>}
            </div></div>
          )}
        </>
      )}
    </main>
  );
}
