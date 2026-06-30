'use client';

// Раздел «Портфели»: тесты стратегий из СЕТАПОВ. Путь — пошаговый мастер:
//   Новый тест → 1) вселенная (сетапы) → 2) ребалансировка → 3) параметры → 4) запуск → автосохранение
//   с именем от AI. Метрики/кривую считает сервер по сигналам сетапов и дневным ценам (/compute).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PortfolioResult, DayPoint } from '@/lib/research/portfolioEngine';

type Parking = 'BIL' | 'SPY' | 'CASH';
type ExecMode = 'ladder' | 'weekly' | 'monthly';
type SetupItem = { id: string; name: string; snapshot?: Record<string, number | string> };
type SavedPortfolio = { id: string; name: string; description: string; config: { setupIds: string[]; execution: ExecMode; ladderN: number; parking: Parking } };
type ComputeMeta = { setups: string[]; execution: ExecMode; ladderN: number; parking: Parking; synthetic: boolean; syntheticSymbols?: number; truncatedSymbols?: number };

const EXEC_LABEL: Record<ExecMode, string> = { ladder: 'лестница', weekly: 'ребаланс/нед', monthly: 'ребаланс/мес' };
const EXEC_FULL: Record<ExecMode, string> = { ladder: 'Лестница', weekly: 'Недельный ребаланс', monthly: 'Месячный ребаланс' };
const PARK_LABEL: Record<Parking, string> = { BIL: 'BIL (T-bills)', SPY: 'SPY', CASH: 'Кэш (0%)' };
const STEPS = ['Вселенная', 'Ребалансировка', 'Параметры', 'Запуск'];

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pf-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

const pct = (x: number | null | undefined, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);
const signPct = (x: number | null | undefined, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%`);
const numFmt = (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(dp));
const signCls = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '' : x > 0 ? 'up' : x < 0 ? 'down' : '');

function fallbackName(setupNames: string[], exec: ExecMode, n: number, parking: Parking): string {
  const head = setupNames.slice(0, 2).join(' + ') + (setupNames.length > 2 ? ` +${setupNames.length - 2}` : '');
  const ex = exec === 'ladder' ? `лестница ${n}` : exec === 'weekly' ? 'нед. ребаланс' : 'мес. ребаланс';
  return `${head} · ${ex} · ${parking}`.slice(0, 63);
}

// SVG-кривая капитала портфеля и SPY (старт = 1), линейная шкала, даунсэмпл до ~400 точек.
function EquityChart({ equity, bench }: { equity: DayPoint[]; bench: DayPoint[] }) {
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
  const vals = [...eq, ...bm].map((p) => p.v).filter((v) => Number.isFinite(v) && v > 0);
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
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-testid="portfolio-equity-svg" role="img" aria-label="Кривая капитала портфеля против S&P 500">
      <line x1={0} y1={yOf(1)} x2={W} y2={yOf(1)} stroke="var(--fk-line)" strokeWidth={1} strokeDasharray="4 4" />
      <path d={path(bm)} fill="none" stroke="var(--fk-text-3)" strokeWidth={1.4} opacity={0.85} />
      <path d={path(eq)} fill="none" stroke="var(--fk-brand-700, #2563eb)" strokeWidth={1.9} />
    </svg>
  );
}

type Gran = 'year' | 'month' | 'week';
type Period = { key: string; label: string; ret: number; spyRet: number; loading: number; days: number; start: string; end: string };
const GRAN_LABEL: Record<Gran, string> = { year: 'Год', month: 'Месяц', week: 'Неделя' };

function periodKey(d: string, g: Gran): { key: string; label: string } {
  if (g === 'year') return { key: d.slice(0, 4), label: d.slice(0, 4) };
  if (g === 'month') return { key: d.slice(0, 7), label: d.slice(0, 7) };
  const ep = Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);
  const wk = Math.floor((ep - 4) / 7); // бакет по понедельникам
  const monday = new Date((wk * 7 + 4) * 86400000).toISOString().slice(0, 10);
  return { key: String(wk), label: monday };
}

// Агрегирует дневные ряды (кривая, бенчмарк, загрузка) в периоды выбранной грануляции.
function aggregatePeriods(equity: DayPoint[], bench: DayPoint[], deployment: number[], g: Gran): Period[] {
  if (equity.length < 2) return [];
  const out: Period[] = [];
  let a = 0;
  let curKey = periodKey(equity[0].d, g).key;
  const flush = (b: number) => {
    const { key, label } = periodKey(equity[a].d, g);
    const base = a === 0 ? 0 : a - 1; // цепляемся от последнего дня прошлого периода
    const ret = equity[base].v > 0 ? equity[b].v / equity[base].v - 1 : 0;
    const spyRet = bench[base] && bench[base].v > 0 ? bench[b].v / bench[base].v - 1 : 0;
    let inm = 0;
    let cnt = 0;
    for (let i = Math.max(a, 1); i <= b; i++) { cnt++; if (deployment[i] > 0) inm++; }
    out.push({ key, label, ret, spyRet, loading: cnt ? inm / cnt : 0, days: b - a + 1, start: equity[a].d, end: equity[b].d });
  };
  for (let i = 1; i < equity.length; i++) {
    const k = periodKey(equity[i].d, g).key;
    if (k !== curKey) { flush(i - 1); a = i; curKey = k; }
  }
  flush(equity.length - 1);
  return out;
}

// Интерактивный бар-чарт: доходность стратегии и SPY по периодам (наведение → детали периода).
function PeriodChart({ periods, hovered, onHover }: { periods: Period[]; hovered: number; onHover: (i: number) => void }) {
  const W = 820;
  const H = 180;
  const mid = H / 2;
  if (!periods.length) return null;
  const maxAbs = Math.max(0.01, ...periods.flatMap((p) => [Math.abs(p.ret), Math.abs(p.spyRet)]));
  const slot = W / periods.length;
  const barW = Math.max(1.2, Math.min(16, slot * 0.34));
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
        return (
          <g key={p.key} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(-1)}>
            {hovered === i && <rect x={i * slot} y={0} width={slot} height={H} fill="var(--fk-surface-2)" />}
            <rect x={cx - barW - 0.5} y={s.y} width={barW} height={s.h} rx={1} fill="var(--fk-brand-700, #2563eb)" />
            <rect x={cx + 0.5} y={b.y} width={barW} height={b.h} rx={1} fill="var(--fk-text-3)" opacity={0.85} />
          </g>
        );
      })}
    </svg>
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

  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [meta, setMeta] = useState<ComputeMeta | null>(null);
  const [ran, setRan] = useState(false);
  const [curId, setCurId] = useState<string>('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gran, setGran] = useState<Gran>('year');
  const [hoverP, setHoverP] = useState<number>(-1);
  const [selWeek, setSelWeek] = useState<string | null>(null); // выбранная неделя (drill-down)

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
    setResult(null);
    setMeta(null);
    setRan(false);
    setCurId('');
    setName('');
    setErr('');
  };

  // расчёт без автосохранения (используется и мастером, и при открытии сохранённого теста)
  const computeOnly = useCallback(
    async (ids: string[], cfg: { execution: ExecMode; ladderN: number; parking: Parking }): Promise<PortfolioResult | null> => {
      const r = await fetch('/api/researcher/portfolios/compute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setupIds: ids, execution: cfg.execution, ladderN: cfg.ladderN, parking: cfg.parking }),
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
    try {
      const res = await computeOnly(ids, { execution: exec, ladderN, parking });
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
          body: JSON.stringify({ setups: setupNames, execution: exec, ladderN, parking, metrics: { cagr: m.cagr, loading: m.loading, excessTotal: m.excessTotal, sharpe: m.sharpe } }),
        }).then((x) => x.json());
        if (rn?.title) title = String(rn.title);
      } catch {
        /* graceful — запасное имя ниже */
      }
      if (!title) title = fallbackName(setupNames, exec, ladderN, parking);
      const id = newId();
      setName(title);
      setCurId(id);
      try {
        await fetch('/api/researcher/portfolios', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, name: title, config: { setupIds: ids, selection: 'all', execution: exec, ladderN, parking } }),
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
  }, [selected, exec, ladderN, parking, setups, computeOnly, loadSaved]);

  // переименование текущего теста (сохранённого)
  const rename = useCallback(
    async (nm: string) => {
      setName(nm);
      if (!curId || !nm.trim()) return;
      try {
        await fetch('/api/researcher/portfolios', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: curId, name: nm.trim(), config: { setupIds: [...selected], selection: 'all', execution: exec, ladderN, parking } }),
        });
        await loadSaved();
      } catch {
        /* graceful */
      }
    },
    [curId, selected, exec, ladderN, parking, loadSaved],
  );

  const openSaved = useCallback(
    async (p: SavedPortfolio) => {
      const ids = p.config.setupIds || [];
      setSelected(new Set(ids));
      setExec(p.config.execution);
      setLadderN(p.config.ladderN ?? 5);
      setParking(p.config.parking);
      setCurId(p.id);
      setName(p.name);
      setStep(0);
      setErr('');
      setBusy(true);
      try {
        await computeOnly(ids, { execution: p.config.execution, ladderN: p.config.ladderN ?? 5, parking: p.config.parking });
        setRan(true);
      } finally {
        setBusy(false);
      }
    },
    [computeOnly],
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

  const m = result?.metrics;
  const stats = useMemo(() => {
    if (!m) return [];
    return [
      { k: 'Загрузка', v: pct(m.loading, 1), sub: `${m.inMarketDays}/${Math.max(0, m.days - 1)} дн. · разв. ${pct(m.avgDeployment, 0)}`, cls: '' },
      { k: 'Годовая (CAGR)', v: signPct(m.cagr), sub: `всего ${signPct(m.total)}`, cls: signCls(m.cagr) },
      { k: 'Макс. просадка', v: pct(m.maxDD), sub: `SPY ${pct(m.spyMaxDD)}`, cls: 'down' },
      { k: 'Sharpe (всего)', v: numFmt(m.sharpe), sub: `SPY ${numFmt(m.spySharpe)}`, cls: signCls(m.sharpe) },
      { k: 'Превышение vs SPY (нагр.)', v: signPct(m.excessActive), sub: `рукав ${signPct(m.activeTotal)} / SPY(нагр) ${signPct(m.spyActiveTotal)}`, cls: signCls(m.excessActive) },
      { k: 'Sharpe (нагр.)', v: numFmt(m.sharpeActive), sub: `SPY(нагр) ${numFmt(m.spySharpeActive)}`, cls: signCls(m.sharpeActive) },
      { k: 'Sharpe к SPY (нагр.)', v: m.sharpeVsSpyActive == null ? '—' : `${numFmt(m.sharpeVsSpyActive)}×`, sub: `всего ${m.sharpeVsSpy == null ? '—' : numFmt(m.sharpeVsSpy) + '×'}`, cls: signCls((m.sharpeVsSpyActive ?? 1) - 1) },
      { k: 'Доходность / загрузка', v: signPct(m.returnOnLoading), sub: 'CAGR ÷ загрузка', cls: signCls(m.returnOnLoading) },
    ];
  }, [m]);

  const periods = useMemo(
    () => (result && result.equity.length > 1 ? aggregatePeriods(result.equity, result.benchEquity, result.deployment, gran) : []),
    [result, gran],
  );
  const hp = hoverP >= 0 && hoverP < periods.length ? periods[hoverP] : null;
  const weekDetail = useMemo(() => (result && selWeek ? result.weeks.find((w) => w.start === selWeek) || null : null), [result, selWeek]);
  useEffect(() => { setSelWeek(null); }, [result, gran]);

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
              <div className="card-t">Тесты</div>
              <div className="pf-saved" data-testid="pf-saved" style={{ marginTop: 10 }}>
                <button className="btn apply on" data-testid="new-test" onClick={newTest}>➕ Новый тест</button>
                {saved.map((p) => (
                  <span key={p.id} className={`chip pf${p.id === curId ? ' on' : ''}`} data-testid="portfolio-chip" onClick={() => openSaved(p)}>
                    {p.name}
                    <span className="bx" data-testid="portfolio-chip-del" onClick={(e) => { e.stopPropagation(); removeSaved(p.id); }}>✕</span>
                  </span>
                ))}
                {!saved.length && <span className="sub" style={{ color: 'var(--fk-text-3)' }}>сохранённых тестов пока нет — создай новый</span>}
              </div>
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
                      Лестница — 1/N капитала в день, транш держим N дней (равный вес среди N перекрывающихся дневных корзин). Недельный/месячный —
                      100% ребаланс в имена с сигналом за период. Срок удержания задаёт исполнение, не горизонт сетапа.
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div className="card-t" style={{ marginBottom: 8 }}>Параметры — паркинг, вес, отбор</div>
                    <div className="pf-controls" style={{ marginTop: 0 }}>
                      <div className="ctl">
                        <span className="lbl">Паркинг простоя</span>
                        <select value={parking} data-testid="pf-parking" onChange={(e) => setParking(e.target.value as Parking)}>
                          <option value="BIL">BIL (T-bills)</option>
                          <option value="SPY">SPY</option>
                          <option value="CASH">Кэш (0%)</option>
                        </select>
                      </div>
                      <div className="ctl"><span className="lbl">Вес · отбор</span><span className="badge">равный · все имена</span></div>
                      <div className="ctl"><span className="lbl">Бенчмарк</span><span className="badge">S&amp;P 500 (SPY)</span></div>
                    </div>
                    <div className="pf-note" style={{ marginTop: 10 }}>
                      Отбор сейчас — «все имена». Топ-K экстремумов (по фактору на входе) и низкокоррелированный отбор — на подходе. Альфа — простое
                      превышение над SPY (без беты). Оценка in-sample на всей истории.
                    </div>
                  </>
                )}

                {step === 4 && (
                  <>
                    <div className="card-t" style={{ marginBottom: 8 }}>Запуск — проверь и посчитай</div>
                    <div className="pf-summary">
                      <div className="row"><span className="k">Сетапы ({selectedNames.length})</span><span>{selectedNames.join(', ') || '—'}</span></div>
                      <div className="row"><span className="k">Исполнение</span><span>{EXEC_FULL[exec]}{exec === 'ladder' ? ` · N=${ladderN}` : ''}</span></div>
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
                {meta?.synthetic && <span className="badge warn" style={{ marginLeft: 8 }}>данные синтетические (без ключей)</span>}
                {!meta?.synthetic && !!meta?.syntheticSymbols && <span className="badge warn" style={{ marginLeft: 8 }}>имён без реальных цен: {meta.syntheticSymbols} (синтетика)</span>}
                {!!meta?.truncatedSymbols && <span className="badge warn" style={{ marginLeft: 8 }}>усечено имён: {meta.truncatedSymbols}</span>}
              </div>
              <div className="pf-note">
                Метрики «(нагр.)» считаются ТОЛЬКО за дни, когда стратегия в рынке, и сравниваются с SPY ровно за те же дни (активный рукав):
                это корректное «на нагрузку». Альфа на нагрузку = превышение рукава над SPY за дни нагрузки. Загрузка — доля дней в рынке
                (BIL не считается). «Доходность/загрузка» = CAGR ÷ загрузка — интенсивность, не достижимая доходность. Оценка in-sample.
              </div>

              {result && result.equity.length > 1 && (
                <>
                  <div className="card-t" style={{ marginTop: 14 }}>Кривая капитала (сложный процент)</div>
                  <div className="pf-chart" data-testid="portfolio-equity">
                    <EquityChart equity={result.equity} bench={result.benchEquity} />
                  </div>
                  <div className="pf-legend">
                    <span><i style={{ background: 'var(--fk-brand-700, #2563eb)' }} />Портфель</span>
                    <span><i style={{ background: 'var(--fk-text-3)' }} />S&amp;P 500 (SPY, buy &amp; hold)</span>
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
                <div className="seg pf-gran" data-testid="pf-gran">
                  {(['year', 'month', 'week'] as Gran[]).map((g) => (
                    <button key={g} className={gran === g ? 'on' : ''} onClick={() => { setGran(g); setHoverP(-1); }}>{GRAN_LABEL[g]}</button>
                  ))}
                </div>
              </div>
              {hp ? (
                <div className="pf-period-sel" data-testid="pf-period-sel">
                  <b>{hp.label}</b> · стратегия <span className={signCls(hp.ret)}>{signPct(hp.ret)}</span> · SPY {signPct(hp.spyRet)} · превышение{' '}
                  <span className={signCls(hp.ret - hp.spyRet)}>{signPct(hp.ret - hp.spyRet)}</span> · загрузка {pct(hp.loading, 0)}
                </div>
              ) : (
                <div className="pf-period-sel muted">наведи на столбец — доходность периода, сравнение с SPY и загрузка</div>
              )}
              <div className="pf-chart">
                <PeriodChart periods={periods} hovered={hoverP} onHover={setHoverP} />
              </div>
              <div className="pf-legend">
                <span><i style={{ background: 'var(--fk-brand-700, #2563eb)' }} />Портфель</span>
                <span><i style={{ background: 'var(--fk-text-3)' }} />S&amp;P 500</span>
              </div>

              <div className="pf-ptable-wrap">
                <table className="pf-ptable" data-testid="pf-period-table">
                  <thead><tr><th className="l">Период</th><th>Стратегия</th><th>SPY</th><th>Превышение</th><th>Загрузка</th></tr></thead>
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
        </>
      )}
    </main>
  );
}
