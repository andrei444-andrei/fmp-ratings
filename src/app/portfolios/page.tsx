'use client';

// Раздел «Портфели»: объединение СЕТАПОВ (находок скринера) в одну стратегию и оценка её совместной
// доходности. Выбираешь сетапы → правила сборки (равный вес, лимит топ-K, паркинг простоя) → считаем
// загрузку, доходность/альфу на загрузку, Sharpe, просадку (сложный процент) против S&P 500.
// Метрики считает сервер по потокам сделок сетапов (см. /api/researcher/portfolios/compute).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PortfolioResult, DayPoint } from '@/lib/research/portfolioEngine';

type Parking = 'BIL' | 'SPY' | 'CASH';
type ExecMode = 'ladder' | 'weekly' | 'monthly';
type SetupItem = { id: string; name: string; snapshot?: Record<string, number | string> };
type SavedPortfolio = { id: string; name: string; description: string; config: { setupIds: string[]; execution: ExecMode; ladderN: number; parking: Parking } };
type ComputeMeta = { setups: string[]; execution: ExecMode; ladderN: number; parking: Parking; synthetic: boolean; truncatedSymbols?: number };

const EXEC_LABEL: Record<ExecMode, string> = { ladder: 'лестница', weekly: 'ребаланс/нед', monthly: 'ребаланс/мес' };

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pf-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

const pct = (x: number | null | undefined, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);
const signPct = (x: number | null | undefined, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%`);
const numFmt = (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(dp));
const signCls = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '' : x > 0 ? 'up' : x < 0 ? 'down' : '');

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
    s
      .map((p, i) => {
        const x = (i / (s.length - 1)) * W;
        const y = H - ((p.v - minV) / (maxV - minV)) * H;
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const yOf = (v: number) => H - ((v - minV) / (maxV - minV)) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-testid="portfolio-equity-svg" role="img" aria-label="Кривая капитала портфеля против S&P 500">
      <line x1={0} y1={yOf(1)} x2={W} y2={yOf(1)} stroke="var(--fk-line)" strokeWidth={1} strokeDasharray="4 4" />
      <path d={path(bm)} fill="none" stroke="var(--fk-text-3)" strokeWidth={1.4} opacity={0.85} />
      <path d={path(eq)} fill="none" stroke="var(--fk-brand-700, #2563eb)" strokeWidth={1.9} />
    </svg>
  );
}

export default function PortfoliosPage() {
  const [setups, setSetups] = useState<SetupItem[]>([]);
  const [saved, setSaved] = useState<SavedPortfolio[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [parking, setParking] = useState<Parking>('BIL');
  const [exec, setExec] = useState<ExecMode>('ladder');
  const [ladderN, setLadderN] = useState<number>(5);
  const [name, setName] = useState('');
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [meta, setMeta] = useState<ComputeMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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

  const compute = useCallback(
    async (ids?: string[], over?: { parking: Parking; execution: ExecMode; ladderN: number }) => {
      const setupIds = ids ?? [...selected];
      if (!setupIds.length) {
        setErr('Выбери хотя бы один сетап.');
        return;
      }
      setBusy(true);
      setErr('');
      try {
        const body = { setupIds, parking: over?.parking ?? parking, execution: over?.execution ?? exec, ladderN: over?.ladderN ?? ladderN };
        const r = await fetch('/api/researcher/portfolios/compute', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then((x) => x.json());
        if (r?.error) {
          setErr(String(r.error));
          setResult(null);
          setMeta(null);
        } else {
          setResult(r.result || null);
          setMeta(r.meta || null);
        }
      } catch (e: any) {
        setErr(e?.message || 'Ошибка расчёта');
      } finally {
        setBusy(false);
      }
    },
    [selected, parking, exec, ladderN],
  );

  const save = useCallback(async () => {
    const nm = name.trim() || `Портфель ${saved.length + 1}`;
    if (!selected.size) {
      setErr('Выбери сетапы перед сохранением.');
      return;
    }
    try {
      await fetch('/api/researcher/portfolios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: newId(), name: nm, config: { setupIds: [...selected], selection: 'all', execution: exec, ladderN, parking } }),
      });
      setName('');
      await loadSaved();
    } catch (e: any) {
      setErr(e?.message || 'Не сохранилось');
    }
  }, [name, saved.length, selected, exec, ladderN, parking, loadSaved]);

  const loadPortfolio = useCallback(
    (p: SavedPortfolio) => {
      const ids = p.config.setupIds || [];
      setSelected(new Set(ids));
      setParking(p.config.parking);
      setExec(p.config.execution);
      setLadderN(p.config.ladderN ?? 5);
      compute(ids, { parking: p.config.parking, execution: p.config.execution, ladderN: p.config.ladderN ?? 5 });
    },
    [compute],
  );

  const removePortfolio = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/researcher/portfolios?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadSaved();
      } catch {
        /* graceful */
      }
    },
    [loadSaved],
  );

  const m = result?.metrics;
  const stats = useMemo(() => {
    if (!m) return [];
    return [
      { k: 'Загрузка', v: pct(m.loading, 1), sub: `${m.inMarketDays}/${Math.max(0, m.days - 1)} дн. · разв. ${pct(m.avgDeployment, 0)}`, cls: '' },
      { k: 'Годовая (CAGR)', v: signPct(m.cagr), sub: `всего ${signPct(m.total)}`, cls: signCls(m.cagr) },
      { k: 'Макс. просадка', v: pct(m.maxDD), sub: `SPY ${pct(m.spyMaxDD)}`, cls: 'down' },
      { k: 'Sharpe', v: numFmt(m.sharpe), sub: `SPY ${numFmt(m.spySharpe)}`, cls: signCls(m.sharpe) },
      { k: 'Превышение vs SPY', v: signPct(m.excessTotal), sub: `год. ${signPct(m.excessCagr)}`, cls: signCls(m.excessTotal) },
      { k: 'Доходность / загрузка', v: signPct(m.returnOnLoading), sub: 'CAGR ÷ загрузка', cls: signCls(m.returnOnLoading) },
      { k: 'Альфа / загрузка', v: signPct(m.alphaOnLoading), sub: '(CAGR − SPY) ÷ загрузка', cls: signCls(m.alphaOnLoading) },
      { k: 'Sharpe к SPY', v: m.sharpeVsSpy == null ? '—' : `${numFmt(m.sharpeVsSpy)}×`, sub: `актив. рукав ${numFmt(m.sharpeActive)}`, cls: signCls((m.sharpeVsSpy ?? 1) - 1) },
    ];
  }, [m]);

  return (
    <main className="rsx pf">
      <div className="top">
        <h1>Портфели</h1>
        <span className="sub">Объединение сетапов в стратегию: загрузка, доходность/альфа на загрузку, Sharpe и просадка против S&amp;P 500</span>
      </div>

      {/* Состав портфеля */}
      <div className="card">
        <div className="card-b">
          <div className="card-t">Состав портфеля</div>

          {saved.length > 0 && (
            <div className="pf-saved" data-testid="pf-saved">
              <span className="lbl">Сохранённые</span>
              {saved.map((p) => (
                <span key={p.id} className="chip pf" data-testid="portfolio-chip" onClick={() => loadPortfolio(p)}>
                  {p.name}
                  <span className="bx" data-testid="portfolio-chip-del" onClick={(e) => { e.stopPropagation(); removePortfolio(p.id); }}>✕</span>
                </span>
              ))}
            </div>
          )}

          {setups.length === 0 ? (
            <div className="pf-empty" data-testid="pf-empty">
              Пока нет сетапов. Сохрани находки в разделе <a href="/researcher">Скринер</a> (вселенная + условия + цифры → «кирпичик»), затем собери из них портфель здесь.
            </div>
          ) : (
            <>
              <div className="grp" style={{ marginTop: 8 }} data-testid="pf-setup-pick">
                {setups.map((s) => {
                  const on = selected.has(s.id);
                  const n = Number(s.snapshot?.n);
                  return (
                    <span key={s.id} className={`chip pick${on ? ' on' : ''}`} data-testid="setup-pick-chip" onClick={() => toggle(s.id)}>
                      {s.name}
                      {Number.isFinite(n) && <span className="m">{n} сд.</span>}
                    </span>
                  );
                })}
              </div>

              <div className="pf-controls">
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
                <div className="ctl">
                  <span className="lbl">Вес · отбор</span>
                  <span className="badge">равный · все имена</span>
                </div>
                <div className="ctl">
                  <span className="lbl">Паркинг простоя</span>
                  <select value={parking} data-testid="pf-parking" onChange={(e) => setParking(e.target.value as Parking)}>
                    <option value="BIL">BIL (T-bills)</option>
                    <option value="SPY">SPY</option>
                    <option value="CASH">Кэш (0%)</option>
                  </select>
                </div>
                <div className="grow">
                  <input className="nin" placeholder="Название портфеля…" value={name} data-testid="pf-name" onChange={(e) => setName(e.target.value)} />
                  <button className="btn" data-testid="portfolio-save" onClick={save} disabled={!selected.size}>Сохранить</button>
                  <button className={`btn apply${selected.size && !busy ? ' on' : ''}`} data-testid="portfolio-compute" onClick={() => compute()} disabled={!selected.size || busy}>
                    {busy ? 'Считаю…' : `Посчитать (${selected.size})`}
                  </button>
                </div>
              </div>
              {err && <div className="pf-err" data-testid="pf-err">{err}</div>}
            </>
          )}
        </div>
      </div>

      {/* Метрики */}
      {m && (
        <div className="card">
          <div className="card-b">
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
              {!!meta?.truncatedSymbols && <span className="badge warn" style={{ marginLeft: 8 }}>усечено имён: {meta.truncatedSymbols}</span>}
            </div>
            <div className="pf-note">
              Исполнение задаёт срок удержания (не горизонт сетапа): лестница — 1/N капитала в день, транш держим N дней; недельный/месячный —
              100% ребаланс в имена с сигналом за период. Отбор сейчас — «все имена» (топ-K экстремумов появится после доработки сетапов;
              низкокоррелированный — позже). Загрузка — доля дней в рынке (BIL не считается). «Доходность/загрузка» = CAGR ÷ загрузка —
              интенсивность, не достижимая доходность. Альфа — простое превышение над SPY (без беты). Оценка in-sample на всей истории.
            </div>
          </div>
        </div>
      )}

      {/* Кривая капитала */}
      {result && result.equity.length > 1 && (
        <div className="card">
          <div className="card-b">
            <div className="card-t">Кривая капитала (сложный процент)</div>
            <div className="pf-chart" data-testid="portfolio-equity">
              <EquityChart equity={result.equity} bench={result.benchEquity} />
            </div>
            <div className="pf-legend">
              <span><i style={{ background: 'var(--fk-brand-700, #2563eb)' }} />Портфель</span>
              <span><i style={{ background: 'var(--fk-text-3)' }} />S&amp;P 500 (SPY, buy &amp; hold)</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
