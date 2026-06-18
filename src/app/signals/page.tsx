'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Select,
  Skeleton,
  Spinner,
  Textarea,
  ToastProvider,
  useToast,
} from '@/components/ui';
import { FACTORS, FACTOR_BY_ID, signalLabel, supportsSkip, type FactorId, type Side, type SignalDef } from '@/lib/signals/factors';
import { UNIVERSE_PRESETS, type UniversePreset } from '@/lib/signals/presets';
import { Heatmap, type HeatCell } from './Heatmap';

type Mode = 'factor' | 'signal' | 'combine';
type SavedSignal = { id: number; name: string; def: SignalDef };

const CUR_YEAR = new Date().getFullYear();
const YEARS: string[] = Array.from({ length: CUR_YEAR - 1999 }, (_, i) => String(CUR_YEAR - i));

function parseList(s: string): number[] {
  return [...new Set(s.split(/[\s,;]+/).map((x) => Number(x)).filter((x) => Number.isFinite(x)))];
}
function fpct(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
}
function fnum(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(d);
}
function resultTitle(r: any): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (r?.mode === 'factor') {
    const f = FACTOR_BY_ID[r.factor];
    return `Фактор · ${f?.label || r.factor} · ${r.bins === 'range' ? 'диапазоны' : r.bins === 'quantile' ? 'топ/дно %' : 'пороги'} · ${ts}`;
  }
  if (r?.mode === 'signal') return `Сигнал · ${signalLabel(r.signal)} · ${ts}`;
  if (r?.mode === 'combine') return `Комбинация · ${r.signals?.length || 0} сигн. · ${ts}`;
  return `Результат · ${ts}`;
}

// erfc-аппроксимация (Abramowitz–Stegun 7.1.26) → двусторонний p-value по t (нормальное приближение).
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = x >= 0 ? y : -y;
  return 1 - erf;
}
function pval(t: number): number {
  if (!Number.isFinite(t)) return 1;
  return Math.min(1, Math.max(0, erfc(Math.abs(t) / Math.SQRT2)));
}

// Точный пересчёт метрик ячейки для произвольного окна лет из по-годовой агрегации.
function aggCell(years: any[], from: number, to: number, mainH: number) {
  if (!Array.isArray(years) || !years.length) return null;
  const sel = years.filter((y) => y.y >= from && y.y <= to);
  if (!sel.length) return null;
  let n = 0, pos = 0, Q = 0;
  const perH: Record<string, [number, number]> = {};
  for (const y of sel) {
    n += y.n || 0; pos += y.pos || 0; Q += y.Q || 0;
    const d = y.d || {};
    for (const h in d) {
      const a = d[h] || [0, 0];
      if (!perH[h]) perH[h] = [0, 0];
      perH[h][0] += a[0] || 0; perH[h][1] += a[1] || 0;
    }
  }
  const mh = String(mainH);
  const [P, S] = perH[mh] || [0, 0];
  if (P < 5 || n < 10) return null;
  const mean = S / P;
  let t = 0;
  if (P > 1) {
    const v = (Q - (S * S) / P) / (P - 1);
    const se = v > 0 ? Math.sqrt(v / P) : 0;
    t = se > 0 ? mean / se : 0;
  }
  const decay = Object.keys(perH)
    .map((h) => ({ h: Number(h), mean: perH[h][0] > 0 ? perH[h][1] / perH[h][0] : null }))
    .sort((a, b) => a.h - b.h);
  const yearly = sel.map((y) => {
    const a = (y.d || {})[mh] || [0, 0];
    return { year: y.y, mean: a[0] > 0 ? a[1] / a[0] : null, n: y.n };
  });
  return { mean, t, hit: n > 0 ? (pos / n) * 100 : 0, n, periods: P, decay, yearly };
}

function bhSig(items: { key: string; p: number }[], alpha: number): Set<string> {
  const arr = items.filter((x) => Number.isFinite(x.p)).sort((a, b) => a.p - b.p);
  const m = arr.length;
  let thr = 0;
  arr.forEach((x, i) => {
    if (x.p <= (alpha * (i + 1)) / m) thr = i + 1;
  });
  const s = new Set<string>();
  arr.forEach((x, i) => {
    if (i < thr) s.add(x.key);
  });
  return s;
}

function YearRange({ min, max, from, to, setFrom, setTo }: { min: number; max: number; from: number; to: number; setFrom: (n: number) => void; setTo: (n: number) => void }) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return (
    <div className="rounded-fk border border-line bg-surface-2 px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2">
        <span className="text-[12px] font-semibold text-ink">Окно лет: {from}–{to}</span>
        <span className="text-[11px] text-ink-3">двигайте — метрики пересчитываются без повторного прогона</span>
      </div>
      <div className="space-y-1">
        <input type="range" min={min} max={max} value={from} data-testid="win-from" onChange={(e) => setFrom(Math.min(Number(e.target.value), to))} className="w-full accent-brand" aria-label="Год от" />
        <input type="range" min={min} max={max} value={to} data-testid="win-to" onChange={(e) => setTo(Math.max(Number(e.target.value), from))} className="w-full accent-brand" aria-label="Год до" />
      </div>
    </div>
  );
}

export default function SignalsPage() {
  return (
    <ToastProvider>
      <Signals />
    </ToastProvider>
  );
}

function Tabs({ tab, setTab }: { tab: Mode; setTab: (m: Mode) => void }) {
  const items: { id: Mode; label: string }[] = [
    { id: 'factor', label: '1 · Фактор' },
    { id: 'signal', label: '2 · Сигнал' },
    { id: 'combine', label: '3 · Комбинация' },
  ];
  return (
    <div className="flex gap-1 rounded-fk bg-surface-2 p-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-testid={`tab-${it.id}`}
          onClick={() => setTab(it.id)}
          className={`flex-1 rounded-fk-sm px-3 py-1.5 text-[13px] font-semibold transition-colors ${
            tab === it.id ? 'bg-surface-elev text-ink shadow-fk-sm' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-fk border border-line bg-surface-elev px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-0.5 text-[20px] font-bold tabular-nums ${tone === 'up' ? 'text-up-strong' : tone === 'down' ? 'text-down-strong' : 'text-ink'}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}

function Signals() {
  const { toast } = useToast();

  // ── Общий конфиг ── (вселенную не выбираем по умолчанию — выбирает пользователь)
  const [presets, setPresets] = useState<Set<UniversePreset>>(new Set());
  const [custom, setCustom] = useState('');
  const [benchmark, setBenchmark] = useState('SPY');
  const [horizon, setHorizon] = useState(5);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  // Динамический список «Крупные акции» (S&P 500 из FMP, с fallback на статику).
  // Динамические списки (preset id → tickers): S&P 500 + страновые акции из FMP.
  const [dynTickers, setDynTickers] = useState<Record<string, string[]>>({});
  const presetTickers = (p: { id: UniversePreset; tickers: string[]; dynamic?: boolean }) =>
    p.dynamic && dynTickers[p.id]?.length ? dynTickers[p.id] : p.tickers;
  async function loadDyn(id: string) {
    if (dynTickers[id]) return;
    try {
      const d = await (await fetch(`/api/signals/universe?preset=${encodeURIComponent(id)}`)).json();
      if (Array.isArray(d?.tickers)) setDynTickers((m) => ({ ...m, [id]: d.tickers }));
    } catch {
      /* fallback на статический список пресета */
    }
  }

  const [tab, setTab] = useState<Mode>('factor');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);
  const [errMsg, setErrMsg] = useState('');

  // ── Фактор ──
  const [factorId, setFactorId] = useState<FactorId>('xbench');
  const factorDef = FACTOR_BY_ID[factorId];
  const [fSide, setFSide] = useState<Side>(factorDef.defaultSide);
  const [fBins, setFBins] = useState<'cumulative' | 'range' | 'quantile'>('cumulative');
  const [fParams, setFParams] = useState<number[]>(factorDef.defaultParams);
  const [fThresholds, setFThresholds] = useState<string>(factorDef.defaultThresholds.join(', '));
  const [fSkip, setFSkip] = useState(0);

  // ── Сигнал ──
  const [sFactor, setSFactor] = useState<FactorId>('momentum');
  const sDef = FACTOR_BY_ID[sFactor];
  const [sParam, setSParam] = useState<number>(sDef.defaultParams[0]);
  const [sSide, setSSide] = useState<Side>(sDef.defaultSide);
  const [sThreshold, setSThreshold] = useState<number>(sDef.defaultThresholds[0]);
  const [sLo, setSLo] = useState<number>(sDef.defaultThresholds[0]);
  const [sHi, setSHi] = useState<number>(sDef.defaultThresholds[sDef.defaultThresholds.length - 1]);
  const [sSkip, setSSkip] = useState(0);

  // ── Комбинация ──
  const [saved, setSaved] = useState<SavedSignal[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [grid0, setGrid0] = useState('');
  const [grid1, setGrid1] = useState('');
  const [minN, setMinN] = useState(30);
  const [folds, setFolds] = useState(4);

  // ── Сохранённые результаты (снимки) ──
  const [savedResults, setSavedResults] = useState<{ id: number; title: string; mode: string; created_at: string }[] | null>(null);
  const [savingResult, setSavingResult] = useState(false);

  const outRef = useRef<HTMLDivElement>(null);

  const universe = useMemo(() => {
    const set = new Set<string>();
    for (const p of UNIVERSE_PRESETS) if (presets.has(p.id)) for (const t of presetTickers(p)) set.add(t);
    for (const t of custom.split(/[\s,;]+/)) {
      const s = t.toUpperCase().trim();
      if (/^[A-Z0-9][A-Z0-9.\-]{0,13}$/.test(s)) set.add(s);
    }
    set.delete(benchmark.toUpperCase().trim());
    return [...set];
  }, [presets, custom, benchmark, dynTickers]);

  // Группы для раздельных таблиц по классам активов (режим «Фактор»): каждая выбранная
  // группа + «свои тикеры» — отдельная таблица.
  const groups = useMemo(() => {
    const out: { label: string; tickers: string[]; benchmark?: string }[] = [];
    for (const pr of UNIVERSE_PRESETS) if (presets.has(pr.id)) out.push({ label: pr.label, tickers: presetTickers(pr), benchmark: pr.benchmark });
    const customSyms = custom
      .split(/[\s,;]+/)
      .map((s) => s.toUpperCase().trim())
      .filter((s) => /^[A-Z0-9][A-Z0-9.\-]{0,13}$/.test(s));
    if (customSyms.length) out.push({ label: 'Свои тикеры', tickers: customSyms });
    return out;
  }, [presets, custom, dynTickers]);

  async function loadSaved() {
    try {
      const d = await (await fetch('/api/signals/saved')).json();
      setSaved(Array.isArray(d?.signals) ? d.signals : []);
    } catch {
      setSaved([]);
    }
  }
  async function loadResults() {
    try {
      const d = await (await fetch('/api/signals/results')).json();
      setSavedResults(Array.isArray(d?.results) ? d.results : []);
    } catch {
      setSavedResults([]);
    }
  }
  useEffect(() => {
    loadSaved();
    loadResults();
    loadDyn('mega'); // S&P 500 подгружаем сразу (частый выбор)
    // Восстанавливаем ПОСЛЕДНИЙ прогон (чтобы перезаход во вкладку не терял карту).
    // Явная кнопка «Сохранить» — для именованного долгого хранения в списке слева.
    try {
      const s = localStorage.getItem('signals:lastResult');
      if (s) setResult(JSON.parse(s));
    } catch {
      /* ignore */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Автосохранение последнего результата в браузере (переживает перезагрузку/перезаход).
  useEffect(() => {
    try {
      if (result) localStorage.setItem('signals:lastResult', JSON.stringify(result));
    } catch {
      /* квота переполнена — не критично */
    }
  }, [result]);

  async function saveCurrentResult() {
    if (!result || savingResult) return;
    setSavingResult(true);
    try {
      const r = await fetch('/api/signals/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: resultTitle(result), mode: result.mode, payload: result }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'не удалось');
      toast({ variant: 'success', title: 'Результат сохранён', description: d?.title });
      loadResults();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка сохранения', description: e?.message });
    } finally {
      setSavingResult(false);
    }
  }
  async function openResult(id: number) {
    try {
      const d = await (await fetch(`/api/signals/results/${id}`)).json();
      const res = d?.result;
      if (!res?.payload) throw new Error('не найдено');
      setRunning(false);
      setErrMsg('');
      setResult(res.payload);
      if (['factor', 'signal', 'combine'].includes(res.payload.mode)) setTab(res.payload.mode);
      setStatus('Сохранённый результат');
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }
  async function deleteResultById(id: number) {
    try {
      await fetch(`/api/signals/results/${id}`, { method: 'DELETE' });
      loadResults();
    } catch {
      /* noop */
    }
  }
  useEffect(() => {
    outRef.current?.scrollTo({ top: 0 });
  }, [result]);

  // Смена фактора в свипе → подставляем его дефолты.
  function changeFactor(id: FactorId) {
    setFactorId(id);
    const f = FACTOR_BY_ID[id];
    setFSide(f.defaultSide);
    setFParams(f.defaultParams);
    setFThresholds(f.defaultThresholds.join(', '));
    setFSkip(0);
  }
  function changeSignalFactor(id: FactorId) {
    setSFactor(id);
    const f = FACTOR_BY_ID[id];
    setSParam(f.defaultParams[0]);
    setSSide(f.defaultSide);
    setSThreshold(f.defaultThresholds[0]);
    setSLo(f.defaultThresholds[0]);
    setSHi(f.defaultThresholds[f.defaultThresholds.length - 1]);
    setSSkip(0);
  }
  function currentSignalDef(): SignalDef {
    const skip = supportsSkip(sFactor) ? sSkip : 0;
    if (sSide === 'band') return { factor: sFactor, param: sParam, side: 'band', lo: sLo, hi: sHi, skip };
    return { factor: sFactor, param: sParam, side: sSide, threshold: sThreshold, skip };
  }

  async function runStudy(payload: Record<string, unknown>) {
    if (running) return;
    if (universe.length < 4) {
      toast({ variant: 'error', title: 'Маловата вселенная', description: 'Нужно ≥ 4 инструментов.' });
      return;
    }
    setRunning(true);
    setResult(null);
    setErrMsg('');
    setStatus('Отправка запроса…');
    try {
      const start = yearFrom ? `${yearFrom}-01-01` : undefined;
      const end = yearTo ? `${yearTo}-12-31` : undefined;
      const res = await fetch('/api/signals/study', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, universe, benchmark: benchmark.toUpperCase().trim() || 'SPY', horizon, start, end }),
      });
      if (!res.body) throw new Error('Нет потока ответа');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === 'status') setStatus(ev.text);
          else if (ev.type === 'result') setResult(ev.data);
          else if (ev.type === 'error') setErrMsg(ev.text || 'ошибка');
          else if (ev.type === 'done') setStatus('Готово');
        }
      }
    } catch (e: any) {
      setErrMsg(e?.message || 'ошибка');
      setStatus('Ошибка');
    } finally {
      setRunning(false);
    }
  }

  async function saveSignalDef(def: SignalDef, name?: string) {
    try {
      const r = await fetch('/api/signals/saved', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ def, name: name || signalLabel(def) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'не удалось');
      toast({ variant: 'success', title: 'Сигнал сохранён', description: d?.name });
      loadSaved();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка', description: e?.message });
    }
  }
  async function deleteSaved(id: number) {
    try {
      await fetch(`/api/signals/saved/${id}`, { method: 'DELETE' });
      setPicked((p) => p.filter((x) => x !== id));
      loadSaved();
    } catch {
      /* noop */
    }
  }

  // ── Запуск по вкладкам ──
  function runFactor() {
    runStudy({
      mode: 'factor', factor: factorId, side: fSide, bins: fBins, params: fParams,
      thresholds: parseList(fThresholds), skip: supportsSkip(factorId) ? fSkip : 0, groups,
    });
  }
  function runSignal() {
    runStudy({ mode: 'signal', signal: currentSignalDef() });
  }
  function runCombine() {
    const sigs = (saved ?? []).filter((s) => picked.includes(s.id)).map((s) => s.def);
    if (sigs.length < 2) {
      toast({ variant: 'error', title: 'Нужно ≥ 2 сигнала', description: 'Сохраните сигналы во вкладке «Сигнал» и выберите минимум два.' });
      return;
    }
    runStudy({
      mode: 'combine',
      signals: sigs,
      grid0: parseList(grid0).length ? parseList(grid0) : FACTOR_BY_ID[sigs[0].factor].defaultThresholds,
      grid1: parseList(grid1).length ? parseList(grid1) : FACTOR_BY_ID[sigs[1].factor].defaultThresholds,
      minN,
      folds,
    });
  }

  function togglePicked(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-[rgba(255,255,255,0.82)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-3 sm:px-6">
          <span className="h-7 w-7 rounded-fk-sm bg-gradient-to-br from-brand to-[#9b8cff] shadow-[0_4px_14px_rgba(109,91,240,0.45)]" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-ink">Модель сигналов</div>
            <div className="text-[11px] text-ink-3">Фактор → Сигнал → Комбинация</div>
          </div>
          <div className="ml-auto">
            <Badge variant="brand">beta</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1280px] grid-cols-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[400px_1fr] lg:py-8">
        {/* Левая колонка — конфиг */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Данные</CardTitle>
              <CardDescription>Вселенная и бенчмарк — общие для всех режимов.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field>
                <Label>Вселенная ({universe.length})</Label>
                <div className="flex flex-wrap gap-2" data-testid="universe-presets">
                  {UNIVERSE_PRESETS.map((p) => {
                    const on = presets.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setPresets((prev) => {
                            const n = new Set(prev);
                            n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                            return n;
                          });
                          if (p.dynamic) loadDyn(p.id); // подтянуть список при включении
                        }}
                        className={`rounded-fk-pill border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                          on ? 'border-brand bg-brand-50 text-brand-700' : 'border-line-strong bg-surface-elev text-ink-2 hover:bg-surface-2'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                {universe.length < 4 && (
                  <p className="text-[11px] font-medium text-warn-strong">Выберите вселенную: группу выше или впишите тикеры ниже (нужно ≥ 4).</p>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label htmlFor="bm">Бенчмарк</Label>
                  <Input id="bm" value={benchmark} onChange={(e) => setBenchmark(e.target.value)} />
                </Field>
                <Field>
                  <Label htmlFor="hz">Горизонт (дн.)</Label>
                  <Select id="hz" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                    <option value={5}>5 (неделя)</option>
                    <option value={10}>10 (2 недели)</option>
                    <option value={21}>21 (месяц)</option>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label htmlFor="yf">Год от</Label>
                  <Select id="yf" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)}>
                    <option value="">самый ранний</option>
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </Select>
                </Field>
                <Field>
                  <Label htmlFor="yt">Год до</Label>
                  <Select id="yt" value={yearTo} onChange={(e) => setYearTo(e.target.value)}>
                    <option value="">текущий</option>
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field>
                <Label htmlFor="ct">Свои тикеры</Label>
                <Textarea id="ct" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="SMH, GLD, TLT" style={{ minHeight: 48 }} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <Tabs tab={tab} setTab={setTab} />
            </CardHeader>
            <CardContent className="space-y-3">
              {tab === 'factor' && (
                <FactorForm
                  factorId={factorId}
                  changeFactor={changeFactor}
                  side={fSide}
                  setSide={setFSide}
                  bins={fBins}
                  setBins={setFBins}
                  params={fParams}
                  setParams={setFParams}
                  thresholds={fThresholds}
                  setThresholds={setFThresholds}
                  skip={fSkip}
                  setSkip={setFSkip}
                  onRun={runFactor}
                  running={running}
                  canRun={universe.length >= 4}
                />
              )}
              {tab === 'signal' && (
                <SignalForm
                  factor={sFactor}
                  changeFactor={changeSignalFactor}
                  param={sParam}
                  setParam={setSParam}
                  side={sSide}
                  setSide={setSSide}
                  threshold={sThreshold}
                  setThreshold={setSThreshold}
                  lo={sLo}
                  setLo={setSLo}
                  hi={sHi}
                  setHi={setSHi}
                  skip={sSkip}
                  setSkip={setSSkip}
                  onRun={runSignal}
                  onSave={() => saveSignalDef(currentSignalDef())}
                  running={running}
                  canRun={universe.length >= 4}
                  saved={saved}
                  onLoad={(d: SignalDef) => changeSignalFactorFromDef(d)}
                  onDelete={deleteSaved}
                />
              )}
              {tab === 'combine' && (
                <CombineForm
                  saved={saved}
                  picked={picked}
                  togglePicked={togglePicked}
                  grid0={grid0}
                  setGrid0={setGrid0}
                  grid1={grid1}
                  setGrid1={setGrid1}
                  minN={minN}
                  setMinN={setMinN}
                  folds={folds}
                  setFolds={setFolds}
                  onRun={runCombine}
                  running={running}
                  canRun={universe.length >= 4}
                  onDelete={deleteSaved}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сохранённые результаты</CardTitle>
              <CardDescription>Снимок отчёта — открывается мгновенно, без пересчёта.</CardDescription>
            </CardHeader>
            <CardContent>
              {savedResults === null ? (
                <Skeleton className="h-10 w-full" />
              ) : savedResults.length === 0 ? (
                <p className="text-sm text-ink-3">Пока пусто. Постройте результат и нажмите «Сохранить результат».</p>
              ) : (
                <ul className="space-y-1" data-testid="saved-results">
                  {savedResults.map((r) => (
                    <li key={r.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        data-testid="result-open"
                        onClick={() => openResult(r.id)}
                        className="min-w-0 flex-1 truncate rounded-fk-sm px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                      >
                        {r.title}
                      </button>
                      <button type="button" aria-label="Удалить результат" onClick={() => deleteResultById(r.id)} className="shrink-0 rounded-fk-sm px-1.5 text-ink-3 hover:text-down">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Правая колонка — результат */}
        <Card className="flex min-h-[60vh] min-w-0 flex-col">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Результат</CardTitle>
            <div className="flex items-center gap-3">
              {running ? (
                <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                  <Spinner className="text-brand" />
                  {status}
                </span>
              ) : status ? (
                <Badge variant={status === 'Ошибка' ? 'down' : 'up'}>{status}</Badge>
              ) : null}
              {result && !running && (
                <Button size="sm" variant="secondary" onClick={saveCurrentResult} loading={savingResult}>
                  Сохранить результат
                </Button>
              )}
            </div>
          </CardHeader>
          <div ref={outRef} className="flex-1 overflow-auto px-5 pb-5 sm:px-6" data-testid="signals-output">
            {errMsg && (
              <div className="rounded-fk border border-down bg-surface-2 px-4 py-3 text-[13px] font-medium text-down-strong">{errMsg}</div>
            )}
            {!result && !errMsg && !running && (
              <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-ink">Здесь появится результат</p>
                <p className="mt-1 max-w-sm text-sm text-ink-3">
                  Режим «Фактор» — карта край × порог; клик по ячейке раскрывает затухание и даёт сохранить сигнал. «Сигнал» — событийный анализ. «Комбинация» — пересечение и автоподбор границ.
                </p>
              </div>
            )}
            {running && !result && <Skeleton className="h-40 w-full" />}
            {result?.mode === 'factor' && <FactorResult data={result} onSave={saveSignalDef} />}
            {result?.mode === 'signal' && <SignalResult data={result} onSave={saveSignalDef} />}
            {result?.mode === 'combine' && <CombineResult data={result} />}
          </div>
        </Card>
      </main>
    </>
  );

  // Загрузка сохранённого сигнала в форму вкладки «Сигнал».
  function changeSignalFactorFromDef(d: SignalDef) {
    const f = FACTOR_BY_ID[d.factor];
    setSFactor(d.factor);
    setSParam(d.param);
    setSSide(d.side);
    if (d.side === 'band') {
      setSLo(d.lo ?? f.defaultThresholds[0]);
      setSHi(d.hi ?? f.defaultThresholds[f.defaultThresholds.length - 1]);
    } else {
      setSThreshold(d.threshold ?? f.defaultThresholds[0]);
    }
    setSSkip(d.skip ?? 0);
    setTab('signal');
  }
}

// ─────────────────────── Формы ───────────────────────

function SideToggle({ side, setSide, allowBand }: { side: Side; setSide: (s: Side) => void; allowBand?: boolean }) {
  const opts: { id: Side; label: string }[] = allowBand
    ? [{ id: 'high', label: '≥ порог' }, { id: 'low', label: '≤ порог' }, { id: 'band', label: 'диапазон' }]
    : [{ id: 'high', label: 'значение ≥ порог' }, { id: 'low', label: 'значение ≤ порог' }];
  return (
    <div className="flex gap-1 rounded-fk bg-surface-2 p-1">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setSide(o.id)}
          className={`flex-1 rounded-fk-sm px-2 py-1 text-[12px] font-semibold transition-colors ${
            side === o.id ? 'bg-surface-elev text-ink shadow-fk-sm' : 'text-ink-3'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FactorSelect({ value, onChange }: { value: FactorId; onChange: (id: FactorId) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as FactorId)} data-testid="factor-select">
      <optgroup label="Основные">
        {FACTORS.filter((f) => f.core).map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </optgroup>
      <optgroup label="Опциональные">
        {FACTORS.filter((f) => !f.core).map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </optgroup>
    </Select>
  );
}

function FactorForm(p: any) {
  const f = FACTOR_BY_ID[p.factorId];
  return (
    <>
      <Field>
        <Label>Фактор</Label>
        <FactorSelect value={p.factorId} onChange={p.changeFactor} />
        <p className="text-[11px] text-ink-3">{f.hint}</p>
      </Field>
      <Field>
        <Label>Биннинг столбцов</Label>
        <div className="flex gap-1 rounded-fk bg-surface-2 p-1">
          {([['cumulative', 'Накопительно (≥/≤)'], ['range', 'Диапазоны (от–до)'], ['quantile', 'Топ/дно %']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => p.setBins(id)}
              className={`flex-1 rounded-fk-sm px-2 py-1 text-[12px] font-semibold transition-colors ${
                p.bins === id ? 'bg-surface-elev text-ink shadow-fk-sm' : 'text-ink-3'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      {p.bins === 'cumulative' && (
        <Field>
          <Label>Сторона сигнала</Label>
          <SideToggle side={p.side} setSide={p.setSide} />
        </Field>
      )}
      <Field>
        <Label>{f.paramLabel} — ось строк</Label>
        <div className="flex flex-wrap gap-1.5">
          {f.paramOptions.map((o: number) => {
            const on = p.params.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => p.setParams(on ? p.params.filter((x: number) => x !== o) : [...p.params, o].sort((a: number, b: number) => a - b))}
                className={`rounded-fk-sm border px-2.5 py-1 text-[12px] tabular-nums transition-colors ${
                  on ? 'border-brand bg-brand-50 text-brand-700' : 'border-line-strong text-ink-2 hover:bg-surface-2'
                }`}
              >
                {o}
              </button>
            );
          })}
        </div>
      </Field>
      <Field>
        <Label htmlFor="thr">
          {p.bins === 'quantile' ? 'Размер хвоста, % — ось столбцов' : `Пороги — ось столбцов (${f.unit || '—'})`}
        </Label>
        <Input
          id="thr"
          value={p.thresholds}
          onChange={(e: any) => p.setThresholds(e.target.value)}
          placeholder={p.bins === 'quantile' ? '2, 5, 10, 25' : 'через запятую'}
        />
        {p.bins === 'quantile' && (
          <p className="text-[11px] text-ink-3">
            На каждую дату берём X% лучших и X% худших по фактору внутри вселенной (кросс-секция, накопительно).
            Имеет смысл на больших вселенных (S&P 500, страновые корзины), не на 10 ETF.
          </p>
        )}
      </Field>
      {supportsSkip(p.factorId) && (
        <Field>
          <Label htmlFor="fskip">Пропуск последних дней (gap)</Label>
          <Input id="fskip" type="number" min={0} value={p.skip} onChange={(e: any) => p.setSkip(Math.max(0, Number(e.target.value) || 0))} />
          <p className="text-[11px] text-ink-3">Исключить последние N торг. дней из расчёта (напр. 5 — убрать недельную реверсию).</p>
        </Field>
      )}
      <Button onClick={p.onRun} loading={p.running} disabled={!p.canRun} fullWidth data-testid="run-study">
        Построить карту
      </Button>
    </>
  );
}

function SignalForm(p: any) {
  const f = FACTOR_BY_ID[p.factor];
  return (
    <>
      <Field>
        <Label>Фактор</Label>
        <FactorSelect value={p.factor} onChange={p.changeFactor} />
      </Field>
      <Field>
        <Label>{f.paramLabel}</Label>
        <Select value={p.param} onChange={(e: any) => p.setParam(Number(e.target.value))}>
          {f.paramOptions.map((o: number) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label>Область</Label>
        <SideToggle side={p.side} setSide={p.setSide} allowBand />
      </Field>
      {p.side === 'band' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <Label htmlFor="slo">От ({f.unit || '—'})</Label>
            <Input id="slo" type="number" value={p.lo} onChange={(e: any) => p.setLo(Number(e.target.value))} />
          </Field>
          <Field>
            <Label htmlFor="shi">До ({f.unit || '—'})</Label>
            <Input id="shi" type="number" value={p.hi} onChange={(e: any) => p.setHi(Number(e.target.value))} />
          </Field>
        </div>
      ) : (
        <Field>
          <Label htmlFor="sthr">Порог ({f.unit || '—'})</Label>
          <Input id="sthr" type="number" value={p.threshold} onChange={(e: any) => p.setThreshold(Number(e.target.value))} />
        </Field>
      )}
      {supportsSkip(p.factor) && (
        <Field>
          <Label htmlFor="sskip">Пропуск последних дней (gap)</Label>
          <Input id="sskip" type="number" min={0} value={p.skip} onChange={(e: any) => p.setSkip(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
      )}
      <div className="flex gap-2">
        <Button onClick={p.onRun} loading={p.running} disabled={!p.canRun} fullWidth data-testid="run-study">
          Проверить сигнал
        </Button>
        <Button variant="secondary" onClick={p.onSave}>Сохранить</Button>
      </div>
      <SavedList saved={p.saved} onLoad={p.onLoad} onDelete={p.onDelete} />
    </>
  );
}

function CombineForm(p: any) {
  return (
    <>
      <Field>
        <Label>Сигналы (выберите 2–3)</Label>
        {p.saved === null ? (
          <Skeleton className="h-16 w-full" />
        ) : p.saved.length === 0 ? (
          <p className="text-[12px] text-ink-3">Нет сохранённых сигналов. Создайте их во вкладке «Сигнал».</p>
        ) : (
          <ul className="space-y-1" data-testid="combine-signals">
            {p.saved.map((s: SavedSignal) => (
              <li key={s.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => p.togglePicked(s.id)}
                  className={`min-w-0 flex-1 truncate rounded-fk-sm border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    p.picked.includes(s.id) ? 'border-brand bg-brand-50 text-brand-700' : 'border-line-strong text-ink-2 hover:bg-surface-2'
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label htmlFor="g0">Сетка порога #1</Label>
          <Input id="g0" value={p.grid0} onChange={(e: any) => p.setGrid0(e.target.value)} placeholder="auto" />
        </Field>
        <Field>
          <Label htmlFor="g1">Сетка порога #2</Label>
          <Input id="g1" value={p.grid1} onChange={(e: any) => p.setGrid1(e.target.value)} placeholder="auto" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label htmlFor="mn">Мин. N в ячейке</Label>
          <Input id="mn" type="number" value={p.minN} onChange={(e: any) => p.setMinN(Number(e.target.value) || 30)} />
        </Field>
        <Field>
          <Label htmlFor="fo">Фолдов (walk-forward)</Label>
          <Input id="fo" type="number" value={p.folds} onChange={(e: any) => p.setFolds(Number(e.target.value) || 4)} />
        </Field>
      </div>
      <Button onClick={p.onRun} loading={p.running} fullWidth data-testid="run-study" disabled={p.picked.length < 2 || !p.canRun}>
        Исследовать комбинацию
      </Button>
      <SavedList saved={p.saved} onDelete={p.onDelete} />
    </>
  );
}

function SavedList({ saved, onLoad, onDelete }: { saved: SavedSignal[] | null; onLoad?: (d: SignalDef) => void; onDelete: (id: number) => void }) {
  if (!saved || saved.length === 0) return null;
  return (
    <Field>
      <Label>Сохранённые сигналы</Label>
      <ul className="space-y-1" data-testid="saved-signals">
        {saved.map((s) => (
          <li key={s.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onLoad?.(s.def)}
              disabled={!onLoad}
              className="min-w-0 flex-1 truncate rounded-fk-sm px-2 py-1 text-left text-[12px] text-ink-2 transition-colors enabled:hover:bg-surface-2 disabled:cursor-default"
            >
              {s.name}
            </button>
            <button type="button" aria-label="Удалить сигнал" onClick={() => onDelete(s.id)} className="shrink-0 rounded-fk-sm px-1.5 text-ink-3 hover:text-down">
              ×
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

// ─────────────────────── Результаты ───────────────────────

// Профиль по горизонтам: накопленная изб. доходность к каждому горизонту (дн.).
// Подписи осей в той же SVG, что и линия → точное выравнивание; нулевая линия; основной горизонт жирнее.
function DecayChart({ points, mainH }: { points: { h: number; mean: number | null }[]; mainH: number }) {
  const valid = points.filter((p) => p.mean != null && Number.isFinite(p.mean));
  if (valid.length < 2) return null;
  const W = 340, H = 104, padX = 16, padTop = 12, padBot = 22;
  const innerW = W - 2 * padX, innerH = H - padTop - padBot;
  const ys = points.map((p) => (p.mean ?? 0) as number);
  let lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
  if (hi === lo) hi = lo + 1;
  const n = points.length;
  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v: number) => padTop + innerH - ((v - lo) / (hi - lo)) * innerH;
  const zeroY = y(0);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.mean ?? 0).toFixed(1)}`).join(' ');
  const last = (points[points.length - 1].mean ?? 0) >= 0;
  const color = last ? 'var(--fk-up)' : 'var(--fk-down)';
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ maxWidth: 460 }} aria-hidden="true">
      <line x1={padX} x2={W - padX} y1={zeroY} y2={zeroY} stroke="var(--fk-line-strong)" strokeWidth={1} strokeDasharray="3 3" />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) =>
        p.mean == null ? null : (
          <circle key={`c${i}`} cx={x(i)} cy={y(p.mean)} r={p.h === mainH ? 4 : 2.6} fill={color} />
        ),
      )}
      {points.map((p, i) => (
        <text key={`t${i}`} x={x(i)} y={H - 7} textAnchor="middle" fontSize={p.h === mainH ? 11 : 10} fontWeight={p.h === mainH ? 700 : 400} fill="var(--fk-text-3)">
          {p.h}
        </text>
      ))}
    </svg>
  );
}

function DecayBlock({ points, mainH }: { points: { h: number; mean: number | null }[]; mainH: number }) {
  if (!points || points.filter((p) => p.mean != null).length < 2) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        Профиль по горизонтам: накопленная изб. дох. (дн.)
      </div>
      <DecayChart points={points} mainH={mainH} />
      <p className="mt-0.5 text-[10px] text-ink-3">Накопленная избыточная доходность к горизонту; жирная точка — основной горизонт {mainH}д (его и показывают метрики выше).</p>
    </div>
  );
}

function YearlyBars({ yearly }: { yearly: any[] }) {
  if (!Array.isArray(yearly) || yearly.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Изменение по годам (ср. изб. дох.)</div>
      <div className="space-y-1">
        {yearly.map((y: any) => (
          <div key={y.year} className="flex items-center gap-2 text-[12px]">
            <span className="w-10 shrink-0 tabular-nums text-ink-2">{y.year}</span>
            <div className="relative h-3 flex-1 rounded-fk-pill bg-surface-2">
              <div
                className={`absolute top-0 h-3 rounded-fk-pill ${(y.mean ?? 0) >= 0 ? 'bg-up' : 'bg-down'}`}
                style={{ left: '50%', width: `${Math.min(50, Math.abs(y.mean ?? 0) * 6)}%`, transform: (y.mean ?? 0) < 0 ? 'translateX(-100%)' : 'none' }}
              />
            </div>
            <span className={`w-16 shrink-0 text-right tabular-nums ${(y.mean ?? 0) >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>{fpct(y.mean)}</span>
            <span className="w-12 shrink-0 text-right text-[10px] text-ink-3">n={y.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TickerTable({ tickers, kw }: { tickers: any[]; kw: any }) {
  if (!Array.isArray(tickers) || tickers.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">По тикерам</span>
        {kw && kw.p != null && (
          <span className="text-[11px] text-ink-3">
            различие между тикерами (Краскел–Уоллис): H={fnum(kw.H)}, p={fnum(kw.p, 3)}
            <span className={kw.p < 0.05 ? 'font-semibold text-up-strong' : 'text-ink-3'}>{kw.p < 0.05 ? ' — значимо' : ' — не значимо'}</span>
          </span>
        )}
      </div>
      <div className="max-h-[280px] overflow-auto rounded-fk border border-line">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-surface-2 text-ink-3">
            <tr>
              <th className="px-2 py-1 text-left font-semibold">Тикер</th>
              <th className="px-2 py-1 text-right font-semibold">Ср. изб. дох.</th>
              <th className="px-2 py-1 text-right font-semibold">t</th>
              <th className="px-2 py-1 text-right font-semibold">n</th>
            </tr>
          </thead>
          <tbody>
            {tickers.map((r: any) => (
              <tr key={r.sym} className="border-t border-line">
                <td className="px-2 py-1 font-medium text-ink">{r.sym}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${(r.mean ?? 0) >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>{fpct(r.mean)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-ink-2">{fnum(r.t)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-ink-3">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetaBar({ meta }: { meta: any }) {
  if (!meta) return null;
  return (
    <p className="text-[11px] text-ink-3">
      {meta.symbols} инструментов · {meta.periods} периодов · {meta.obs} наблюдений · окно {meta.first} — {meta.last} · бенчмарк {meta.benchmark}
      {!meta.has_bench && ' (не загрузился — доходность абсолютная)'}
    </p>
  );
}

function regionLabel(f: any, region: any): string {
  const unit = f ? f.unit : '';
  if (!region) return '';
  if (region.side === 'pct_low') return `худшие ${region.q}% по фактору`;
  if (region.side === 'pct_high') return `лучшие ${region.q}% по фактору`;
  if (region.side === 'band') return `∈ [${region.lo}; ${region.hi}]${unit}`;
  return `${region.side === 'high' ? '≥' : '≤'} ${region.threshold}${unit}`;
}

function FactorResult({ data, onSave }: { data: any; onSave: (d: SignalDef, name?: string) => void }) {
  const f = FACTOR_BY_ID[data.factor];
  const isRange = data.bins === 'range';
  const groups: any[] = data.groups && data.groups.length ? data.groups : [{ label: null, baseline: data.baseline, grid: data.grid }];
  const multi = groups.length > 1;
  const minY = Number((data.meta?.first || '').slice(0, 4)) || 2000;
  const maxY = Number((data.meta?.last || '').slice(0, 4)) || CUR_YEAR;
  const hasYears = groups.some((g) => (g.grid || []).some((c: any) => Array.isArray(c.years)));
  const [winFrom, setWinFrom] = useState(minY);
  const [winTo, setWinTo] = useState(maxY);
  useEffect(() => {
    setWinFrom(minY);
    setWinTo(maxY);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = winFrom <= minY && winTo >= maxY;
  return (
    <div className="space-y-5">
      <MetaBar meta={data.meta} />
      <Badge variant="neutral">
        {f.label} · {data.bins === 'quantile' ? 'топ/дно %' : isRange ? 'диапазоны' : data.side === 'high' ? '≥ порог' : '≤ порог'} · гор. {data.horizon}д
        {data.skip ? ` · gap ${data.skip}д` : ''}
      </Badge>
      {hasYears && <YearRange min={minY} max={maxY} from={winFrom} to={winTo} setFrom={setWinFrom} setTo={setWinTo} />}
      {multi && (
        <p className="text-[12px] text-ink-3">Разные классы активов — отдельными таблицами: сравните, отличается ли поведение фактора.</p>
      )}
      {groups.map((g: any, i: number) => (
        <FactorGroup key={i} data={data} group={g} f={f} isRange={isRange} multi={multi} onSave={onSave} winFrom={winFrom} winTo={winTo} fullWindow={full} />
      ))}
    </div>
  );
}

function FactorGroup({ data, group, f, isRange, multi, onSave, winFrom, winTo, fullWindow }: { data: any; group: any; f: any; isRange: boolean; multi: boolean; onSave: (d: SignalDef, name?: string) => void; winFrom: number; winTo: number; fullWindow: boolean }) {
  const [sel, setSel] = useState<HeatCell | null>(null);
  const mainH: number = data.horizon;
  const alpha: number = data.fdrAlpha || 0.1;
  const isQ: boolean = data.bins === 'quantile';
  const grid: any[] = group.grid || [];
  const useWin = grid.some((g: any) => Array.isArray(g.years));

  // Пересчёт каждой ячейки под выбранное окно лет (из по-годовой агрегации).
  const recomputed = useMemo(
    () => grid.map((g: any) => ({ g, agg: useWin && g.years ? aggCell(g.years, winFrom, winTo, mainH) : null })),
    [grid, useWin, winFrom, winTo, mainH],
  );
  const sigSet = useMemo(() => {
    if (!useWin) return null;
    return bhSig(recomputed.filter((r) => r.agg).map((r) => ({ key: `${r.g.param}:${r.g.col}`, p: pval(r.agg!.t) })), alpha);
  }, [recomputed, useWin, alpha]);

  const cells: HeatCell[] = recomputed.map(({ g, agg }) => ({
    row: g.param,
    col: g.col,
    value: agg ? agg.mean : useWin ? null : g.mean,
    n: agg ? agg.n : useWin ? 0 : g.n,
    sig: useWin ? !!(sigSet && sigSet.has(`${g.param}:${g.col}`)) : g.sig,
  }));

  const selRec = sel ? recomputed.find((r) => r.g.param === sel.row && r.g.col === sel.col) : null;
  const cell = selRec?.g;
  const agg = selRec?.agg;
  // Базовая доходность группы — за полное окно (по-годовой базы для неё не храним).
  const head = agg || (cell ? { mean: cell.mean, t: cell.t, hit: cell.hit, n: cell.n, periods: cell.periods, decay: null, yearly: cell.yearly } : null);
  const decayPoints = agg
    ? agg.decay
    : cell?.decay
      ? (data.hz || []).map((h: number) => ({ h, mean: cell.decay[String(h)] ?? null }))
      : [];

  return (
    <div className={multi ? 'space-y-3 rounded-fk border border-line bg-surface-elev p-3' : 'space-y-3'}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {group.label && <span className="text-[13px] font-bold text-ink">{group.label}</span>}
        {group.symbols != null && <span className="text-[11px] text-ink-3">{group.symbols} инстр.</span>}
        {group.benchmark && (
          <span className="text-[11px] text-ink-3">
            vs {group.benchmark}
            {group.has_bench === false && <span className="text-warn-strong"> (бенчмарк не загрузился)</span>}
          </span>
        )}
        <span className="text-[11px] text-ink-3">базовая дох.: {fpct(group.baseline)}</span>
      </div>
      <Heatmap
        cells={cells}
        rows={data.params}
        cols={data.cols}
        rowLabel="Параметр"
        colLabel={isQ ? 'Хвост' : isRange ? 'Диапазон' : 'Порог'}
        selected={sel ? { row: sel.row, col: sel.col } : null}
        onSelect={setSel}
        fmt={(v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2))}
      />
      {!sel && (
        <p className="text-[11px] text-ink-3">
          {isRange ? 'Диапазоны не пересекаются — видно вклад каждой зоны отдельно. ' : ''}
          {isQ ? 'Хвосты кросс-секционные (на каждую дату) и накопительные: «дно 5%» включает «дно 2%». Сравните худшие↔лучшие. ' : ''}
          Точка в углу ячейки = значимо (FDR). Клик по ячейке — детали.
        </p>
      )}
      {cell && (
        <Card>
          <CardHeader>
            <CardTitle>
              {group.label ? group.label + ' · ' : ''}{f.label} ({cell.param}д) {regionLabel(f, cell.region)}
              {!fullWindow && <span className="text-[12px] font-normal text-ink-3"> · {winFrom}–{winTo}</span>}
            </CardTitle>
            <CardDescription>Метрики и профиль по горизонтам — за выбранное окно лет; разбивка по тикерам — за весь период прогона.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {head && head.mean != null ? (
              <div className="flex flex-wrap gap-3">
                <Stat label="Ср. изб. дох." value={fpct(head.mean)} tone={(head.mean ?? 0) >= 0 ? 'up' : 'down'} />
                <Stat label="t-стат" value={fnum(head.t)} />
                <Stat label="Доля плюс" value={fnum(head.hit, 1) + '%'} />
                <Stat label="Наблюдений" value={String(head.n)} hint={`${head.periods} периодов`} />
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">В выбранном окне лет слишком мало наблюдений — расширьте окно.</p>
            )}
            {decayPoints.length > 0 && <DecayBlock points={decayPoints} mainH={mainH} />}
            <YearlyBars yearly={head?.yearly ?? cell.yearly} />
            <TickerTable tickers={cell.tickers} kw={cell.kw} />
            {!isQ && (
              <Button size="sm" variant="secondary" onClick={() => onSave({ factor: data.factor, param: cell.param, ...cell.region, skip: data.skip || 0 })}>
                Сохранить как сигнал
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SignalResult({ data, onSave }: { data: any; onSave: (d: SignalDef, name?: string) => void }) {
  const f = FACTOR_BY_ID[data.signal.factor];
  const st = data.stat;
  return (
    <div className="space-y-4">
      <MetaBar meta={data.meta} />
      <div className="flex items-center gap-2">
        <Badge variant="brand">{signalLabel(data.signal)}</Badge>
        <Button size="sm" variant="secondary" onClick={() => onSave(data.signal)}>Сохранить</Button>
      </div>
      {st ? (
        <div className="flex flex-wrap gap-3">
          <Stat label="Ср. изб. дох." value={fpct(st.mean)} tone={st.mean >= 0 ? 'up' : 'down'} />
          <Stat label="t-стат (period)" value={fnum(st.t)} />
          <Stat label="Преимущ. к среднему" value={fpct(st.edge)} tone={st.edge >= 0 ? 'up' : 'down'} />
          <Stat label="Доля плюс" value={fnum(st.hit, 1) + '%'} />
          <Stat label="Наблюдений" value={String(st.n)} hint={`${st.periods} периодов · база ${fpct(data.baseline)}`} />
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">Слишком мало событий для надёжной статистики — ослабьте порог.</p>
      )}
      {data.decay && (
        <DecayBlock points={data.decay.map((d: any) => ({ h: d.h, mean: d.mean }))} mainH={data.horizon} />
      )}
      <YearlyBars yearly={data.yearly} />
      <TickerTable tickers={data.tickers} kw={data.kw} />
    </div>
  );
}

function CombineResult({ data }: { data: any }) {
  const sigs: SignalDef[] = data.signals;
  const at = data.autotune;
  const cells: HeatCell[] = (data.grid || []).map((g: any) => ({ row: g.t0, col: g.t1, value: g.mean, n: g.n }));
  return (
    <div className="space-y-4">
      <MetaBar meta={data.meta} />
      <div className="flex flex-wrap gap-2">
        {sigs.map((s, i) => (
          <Badge key={i} variant="neutral">#{i} {signalLabel(s)}</Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {data.intersection ? (
          <>
            <Stat label="Пересечение (все)" value={fpct(data.intersection.mean)} tone={data.intersection.mean >= 0 ? 'up' : 'down'} hint={`t=${fnum(data.intersection.t)} · n=${data.intersection.n}`} />
          </>
        ) : (
          <Stat label="Пересечение" value="мало N" />
        )}
        {data.alone?.map((a: any) => (
          <Stat key={a.i} label={`Сигнал #${a.i} один`} value={fpct(a.mean)} hint={`t=${fnum(a.t)} · n=${a.n}`} />
        ))}
      </div>
      {Array.isArray(data.coactivation) && data.coactivation.length > 0 && (
        <div className="text-[12px] text-ink-2">
          <span className="font-semibold text-ink-3">Со-активность: </span>
          {data.coactivation.map((c: any, i: number) => (
            <span key={i} className="mr-3">
              #{c.i}∩#{c.j}: {fnum(c.both_pct, 1)}% времени, corr {fnum(c.corr)}
            </span>
          ))}
        </div>
      )}
      {cells.length > 0 ? (
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Карта пересечения: порог #{data.tun_idx?.[0] ?? 0} × порог #{data.tun_idx?.[1] ?? 1} → ср. изб. дох.
          </div>
          <Heatmap
            cells={cells}
            rows={data.grid0}
            cols={data.grid1}
            rowLabel={`Порог #${data.tun_idx?.[0] ?? 0}`}
            colLabel={`Порог #${data.tun_idx?.[1] ?? 1}`}
            fmt={(v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2))}
          />
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">2D-карта и автоподбор доступны при ≥2 пороговых сигналах (≥/≤); диапазонные сигналы участвуют только как фильтр.</p>
      )}
      {at ? (
        <Card>
          <CardHeader>
            <CardTitle>Автоподбор границ (walk-forward)</CardTitle>
            <CardDescription>Пороги ищем на train, метрику показываем OOS. Расхождение IS ≫ OOS = переподгонка.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Stat label="Средний IS" value={fpct(at.is_mean)} tone="up" />
              <Stat label="Средний OOS" value={fpct(at.oos_mean)} tone={(at.oos_mean ?? 0) >= 0 ? 'up' : 'down'} hint={`мин. N=${at.min_n}`} />
            </div>
            <div className="space-y-1">
              {at.folds.map((fd: any) => (
                <div key={fd.fold} className="flex items-center gap-2 text-[12px] tabular-nums">
                  <span className="w-12 text-ink-3">fold {fd.fold}</span>
                  <span className="w-28 text-ink-2">пороги {fd.t0} / {fd.t1}</span>
                  <span className="w-20 text-right text-ink-3">IS {fpct(fd.is_mean)}</span>
                  <span className={`w-24 text-right ${(fd.oos_mean ?? 0) >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>OOS {fpct(fd.oos_mean)}</span>
                  <span className="w-16 text-right text-[10px] text-ink-3">n={fd.oos_n}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : data.tun_idx ? (
        <p className="text-[13px] text-ink-3">Автоподбор пропущен: коротковата история периодов для walk-forward.</p>
      ) : null}
    </div>
  );
}
