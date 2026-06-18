'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldHint,
  Input,
  Label,
  Modal,
  Skeleton,
  Spinner,
  Switch,
  Textarea,
  ToastProvider,
  useToast,
} from '@/components/ui';
import { DEFAULT_STRATEGY, UNIVERSE_PRESETS } from '@/lib/backtest/presets';

type SavedRunItem = { id: number; title: string | null; created_at: string };

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}
function renderMd(md: string): string {
  try {
    return marked.parse(md || '', { async: false, breaks: true }) as string;
  } catch {
    return esc(md);
  }
}

type EquityPayload = {
  strat: number[];
  bench: (number | null)[] | null;
  init: number;
  d0: string;
  d1: string;
  done: boolean;
};

function fmtPct(x: number): string {
  return (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
}

// Рендер кривой капитала в SVG-строку. Используется и для живого слота (по ходу прогона),
// и для встраивания в сохранённый HTML результата (статичный снимок).
function equitySvg(p: EquityPayload | null): string {
  if (!p || !Array.isArray(p.strat) || p.strat.length < 2) {
    return '<div class="rblk"><div class="rcap">Кривая капитала</div><div class="rt-note">сбор данных…</div></div>';
  }
  const strat = p.strat;
  const bench = Array.isArray(p.bench) ? p.bench : null;
  const W = 1000;
  const H = 240;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 8;
  const n = strat.length;
  const init = Number.isFinite(p.init) ? p.init : strat[0];
  const vals: number[] = [init];
  for (const v of strat) if (Number.isFinite(v)) vals.push(v);
  if (bench) for (const v of bench) if (v != null && Number.isFinite(v)) vals.push(v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const poly = (arr: (number | null)[]) => {
    const pts: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v == null || !Number.isFinite(v)) continue;
      pts.push(x(i).toFixed(1) + ',' + y(v).toFixed(1));
    }
    return pts.join(' ');
  };
  const baseY = y(init).toFixed(1);
  const last = strat[n - 1];
  const ret = init > 0 ? (last / init - 1) * 100 : 0;
  let bRet: number | null = null;
  if (bench) {
    for (let i = bench.length - 1; i >= 0; i--) {
      const v = bench[i];
      if (v != null && Number.isFinite(v)) {
        bRet = init > 0 ? (v / init - 1) * 100 : 0;
        break;
      }
    }
  }
  const svg =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
    'style="width:100%;height:240px;display:block">' +
    '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY +
    '" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>' +
    (bench
      ? '<polyline fill="none" stroke="#94a3b8" stroke-width="1.5" vector-effect="non-scaling-stroke" points="' + poly(bench) + '"/>'
      : '') +
    '<polyline fill="none" stroke="#6d5bf0" stroke-width="2" vector-effect="non-scaling-stroke" points="' + poly(strat) + '"/>' +
    '</svg>';
  return (
    '<div class="rblk">' +
    '<div class="rcap">Кривая капитала' + (p.done ? '' : ' · идёт расчёт…') + '</div>' +
    '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;margin-bottom:6px">' +
    '<span style="color:#6d5bf0">● Стратегия ' + fmtPct(ret) + '</span>' +
    (bRet != null ? '<span style="color:#94a3b8">● Бенчмарк ' + fmtPct(bRet) + '</span>' : '') +
    '</div>' +
    svg +
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:4px">' +
    '<span>' + esc(p.d0) + '</span><span>' + esc(p.d1) + '</span></div>' +
    '</div>'
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4L18 10a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16v4z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BacktestPage() {
  return (
    <ToastProvider>
      <Backtest />
    </ToastProvider>
  );
}

function Backtest() {
  const { toast } = useToast();

  // ── Конфиг ──
  const [presets, setPresets] = useState<Set<string>>(new Set(['mega']));
  const [custom, setCustom] = useState('');
  const [benchmark, setBenchmark] = useState('SPY');
  const [initialCapital, setInitialCapital] = useState(100000);
  const [maxLeverage, setMaxLeverage] = useState(0); // 0 = без лимита плеча
  const [allowShort, setAllowShort] = useState(true);
  const [start, setStart] = useState('2010-01-01');
  const [end, setEnd] = useState(() => {
    // По умолчанию — сегодня минус 6 мес (хвост-холдаут).
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  });

  // ── Стратегия ──
  const [strategy, setStrategy] = useState(DEFAULT_STRATEGY);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [drafting, setDrafting] = useState(false);

  // ── Прогон ──
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [log, setLog] = useState('');
  const [isFresh, setIsFresh] = useState(false);
  const [viewDesc, setViewDesc] = useState<string | null>(null);
  const [liveChart, setLiveChart] = useState<EquityPayload | null>(null);
  const [openedRunId, setOpenedRunId] = useState<number | null>(null);
  const lastConfigRef = useRef<Record<string, unknown> | null>(null);

  // ── Сохранённые прогоны ──
  const [savedRuns, setSavedRuns] = useState<SavedRunItem[] | null>(null);
  const [runModal, setRunModal] = useState<
    { mode: 'save' | 'edit'; id?: number; title: string; description: string } | null
  >(null);
  const [runPreview, setRunPreview] = useState(false);
  const [savingResult, setSavingResult] = useState(false);

  const outRef = useRef<HTMLDivElement>(null);

  const universe = useMemo(() => {
    const set = new Set<string>();
    for (const p of UNIVERSE_PRESETS) {
      if (presets.has(p.id)) for (const t of p.tickers) set.add(t);
    }
    for (const t of custom.split(/[\s,;]+/)) {
      const s = t.toUpperCase().trim();
      if (SYMBOL_RE.test(s)) set.add(s);
    }
    set.delete(benchmark.toUpperCase().trim());
    return [...set];
  }, [presets, custom, benchmark]);

  async function loadRuns() {
    try {
      const d = await (await fetch('/api/backtest/runs')).json();
      setSavedRuns(Array.isArray(d?.runs) ? d.runs : []);
    } catch {
      setSavedRuns([]);
    }
  }
  useEffect(() => {
    loadRuns();
  }, []);
  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight, behavior: 'smooth' });
  }, [blocks, log, status]);

  function togglePreset(id: string) {
    setPresets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildResultHtml(): string {
    const logHtml = log ? `<pre class="rlog">${esc(log)}</pre>` : '';
    const chartHtml = liveChart ? equitySvg(liveChart) : '';
    return chartHtml + logHtml + blocks.join('');
  }

  function buildConfig() {
    return {
      universe,
      benchmark: benchmark.toUpperCase().trim() || 'SPY',
      initialCapital,
      maxLeverage,
      allowShort,
      start: start.trim() || undefined,
      end: end.trim() || undefined,
    };
  }

  async function draft() {
    if (drafting) return;
    if (!draftPrompt.trim()) {
      toast({ variant: 'error', title: 'Опишите стратегию', description: 'Например: «лонг при пробое 50-дневного максимума, шорт при пробое минимума».' });
      return;
    }
    setDrafting(true);
    try {
      const r = await fetch('/api/backtest/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: draftPrompt }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Не удалось сгенерировать');
      if (d?.code) {
        setStrategy(d.code);
        toast({ variant: 'success', title: 'Черновик готов', description: 'Проверьте код перед запуском.' });
      }
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка AI-черновика', description: e?.message });
    } finally {
      setDrafting(false);
    }
  }

  async function execute() {
    if (running) return;
    if (universe.length < 1) {
      toast({ variant: 'error', title: 'Пустая вселенная', description: 'Выберите пресет или добавьте тикеры.' });
      return;
    }
    if (!strategy.trim()) {
      toast({ variant: 'error', title: 'Пустая стратегия', description: 'Нужна функция on_bar(ctx).' });
      return;
    }
    const config = buildConfig();
    lastConfigRef.current = config;
    setRunning(true);
    setIsFresh(true);
    setBlocks([]);
    setLog('');
    setViewDesc(null);
    setLiveChart(null);
    setOpenedRunId(null);
    setStatus('Отправка запроса…');
    try {
      const res = await fetch('/api/backtest/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config, strategy }),
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
          else if (ev.type === 'block') {
            // Снимки кривой капитала перехватываем — рисуем в живом слоте, не копим блоками.
            const m = typeof ev.html === 'string' && ev.html.match(/data-bt-equity='([A-Za-z0-9+/=]+)'/);
            if (m) {
              try {
                setLiveChart(JSON.parse(atob(m[1])));
              } catch {
                /* битый снимок — пропускаем */
              }
            } else {
              setBlocks((b) => [...b, ev.html]);
            }
          } else if (ev.type === 'log') setLog((l) => l + ev.text);
          else if (ev.type === 'done') setStatus('Готово');
        }
      }
    } catch (e: any) {
      setStatus('Ошибка');
      toast({ variant: 'error', title: 'Ошибка выполнения', description: e?.message });
    } finally {
      setRunning(false);
    }
  }

  function openSaveResultModal() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setRunModal({ mode: 'save', title: `Бэктест · ${ts}`, description: '' });
    setRunPreview(false);
  }

  async function openEditRun(id: number) {
    try {
      const d = await (await fetch(`/api/backtest/runs/${id}`)).json();
      const run = d?.run;
      if (!run) throw new Error('Результат не найден');
      setRunModal({ mode: 'edit', id, title: run.title || '', description: run.description || '' });
      setRunPreview(false);
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }

  async function confirmRunModal() {
    if (!runModal || !runModal.title.trim()) return;
    setSavingResult(true);
    try {
      if (runModal.mode === 'save') {
        const resultHtml = buildResultHtml();
        if (!resultHtml) throw new Error('нечего сохранять');
        const r = await fetch('/api/backtest/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resultHtml,
            title: runModal.title.trim(),
            description: runModal.description,
            config: lastConfigRef.current,
            strategy,
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить результат');
        toast({ variant: 'success', title: 'Результат сохранён', description: d?.title });
      } else {
        const r = await fetch(`/api/backtest/runs/${runModal.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: runModal.title.trim(), description: runModal.description }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить');
        toast({ variant: 'success', title: 'Изменения сохранены' });
      }
      setRunModal(null);
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка сохранения', description: e?.message });
    } finally {
      setSavingResult(false);
    }
  }

  async function openSavedRun(id: number) {
    try {
      const d = await (await fetch(`/api/backtest/runs/${id}`)).json();
      const run = d?.run;
      if (!run) throw new Error('Результат не найден');
      setRunning(false);
      setIsFresh(false);
      setLog('');
      setLiveChart(null);
      setOpenedRunId(id);
      setBlocks(run.result_html ? [run.result_html] : []);
      if (typeof run.strategy === 'string' && run.strategy.trim()) setStrategy(run.strategy);
      setViewDesc(run.description || null);
      setStatus('Сохранённый результат');
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }

  async function onDeleteRun(id: number) {
    try {
      const r = await fetch(`/api/backtest/runs/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Ошибка');
      toast({ variant: 'success', title: 'Результат удалён' });
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось удалить', description: e?.message });
    }
  }

  const hasOutput = blocks.length > 0 || log.length > 0 || !!liveChart || running;
  const canSaveResult = isFresh && !running && (blocks.length > 0 || log.length > 0 || !!liveChart);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-[rgba(255,255,255,0.82)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-3 sm:px-6">
          <span className="h-7 w-7 rounded-fk-sm bg-gradient-to-br from-brand to-[#9b8cff] shadow-[0_4px_14px_rgba(109,91,240,0.45)]" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-ink">Тестирование стратегий</div>
            <div className="text-[11px] text-ink-3">Событийный движок · издержки по рынку · плечо · шорты</div>
          </div>
          <div className="ml-auto">
            <Badge variant="brand">beta</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1280px] grid-cols-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[360px_1fr] lg:py-8">
        {/* Левая колонка — конфиг + сохранённые */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Параметры теста</CardTitle>
              <CardDescription>
                Вселенная, бенчмарк, капитал и риск-лимиты. Издержки выбираются автоматически по рынку инструмента
                (US, Польша .WA, Япония .T и т.д.) и показываются в отчёте.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <Label>Вселенная инструментов</Label>
                <div className="flex flex-wrap gap-2" data-testid="universe-presets">
                  {UNIVERSE_PRESETS.map((p) => {
                    const on = presets.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePreset(p.id)}
                        className={`rounded-fk-pill border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                          on
                            ? 'border-brand bg-brand-50 text-brand-700'
                            : 'border-line-strong bg-surface-elev text-ink-2 hover:bg-surface-2'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-ink-3">Выбрано инструментов: {universe.length}</p>
              </Field>

              <Field>
                <Label htmlFor="custom-tickers">Свои тикеры (через запятую/пробел)</Label>
                <Textarea
                  id="custom-tickers"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="напр.: CDR.WA, 7203.T, SMH"
                  style={{ minHeight: 56 }}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label htmlFor="benchmark">Бенчмарк</Label>
                  <Input id="benchmark" value={benchmark} onChange={(e) => setBenchmark(e.target.value)} placeholder="SPY" />
                </Field>
                <Field>
                  <Label htmlFor="capital">Капитал</Label>
                  <Input
                    id="capital"
                    type="number"
                    value={initialCapital}
                    min={100}
                    onChange={(e) => setInitialCapital(Number(e.target.value) || 100000)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label htmlFor="leverage">Макс. плечо</Label>
                  <Input
                    id="leverage"
                    type="number"
                    step={0.1}
                    value={maxLeverage || ''}
                    min={0}
                    max={10}
                    placeholder="без лимита"
                    onChange={(e) => setMaxLeverage(Math.max(0, Number(e.target.value) || 0))}
                  />
                  <FieldHint>Пусто или 0 — без лимита плеча.</FieldHint>
                </Field>
                <Field>
                  <Label htmlFor="short">Шорты разрешены</Label>
                  <div className="flex h-9 items-center">
                    <Switch id="short" checked={allowShort} onCheckedChange={setAllowShort} />
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label htmlFor="start">Начало (опц.)</Label>
                  <Input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </Field>
                <Field>
                  <Label htmlFor="end">Конец (опц.)</Label>
                  <Input id="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сохранённые прогоны</CardTitle>
              <CardDescription>Снимок отчёта + конфиг + код. Кликните, чтобы открыть.</CardDescription>
            </CardHeader>
            <CardContent>
              {savedRuns === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : savedRuns.length === 0 ? (
                <p className="text-sm text-ink-3">Пока пусто. Запустите бэктест и сохраните результат.</p>
              ) : (
                <ul className="space-y-1.5" data-testid="saved-runs">
                  {savedRuns.map((r) => (
                    <li key={r.id} className="flex items-stretch gap-1">
                      <button
                        type="button"
                        data-testid="run-open"
                        onClick={() => openSavedRun(r.id)}
                        className="min-w-0 flex-1 rounded-fk-sm px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                      >
                        <span className="block truncate text-[13px] text-ink-2">{r.title || `Прогон #${r.id}`}</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Редактировать прогон"
                        onClick={() => openEditRun(r.id)}
                        className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        aria-label="Удалить прогон"
                        onClick={() => onDeleteRun(r.id)}
                        className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-down focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Правая колонка — стратегия + результат */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Стратегия (Python · on_bar)</CardTitle>
              <CardDescription>
                Объявите <code>def on_bar(ctx):</code> (и опц. <code>initialize</code>). ctx даёт только прошлое;
                заявки исполняются по close следующего бара.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* AI-помощник: описание задачи словами → готовый код стратегии */}
              <div className="space-y-2 rounded-fk border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-fk-pill bg-brand-50 text-[10px] font-bold text-brand">AI</span>
                  <span className="text-[13px] font-semibold text-ink">Сгенерировать стратегию по описанию</span>
                </div>
                <Textarea
                  aria-label="Описание задачи для AI"
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  data-testid="draft-prompt"
                  placeholder={
                    'Опишите словами, что должна делать стратегия. Например:\n' +
                    '• Лонг, пока цена выше 200-дневной SMA, иначе уходим в кэш.\n' +
                    '• Раз в месяц держим топ-5 по 6-месячному моментуму, шортим худшие 5.\n' +
                    '• Покупка при пробое 50-дневного максимума, выход ниже 20-дневного минимума.'
                  }
                  className="min-h-[110px] text-[13px]"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') draft();
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-ink-3">Код подставится в редактор ниже — проверьте перед запуском. ⌘/Ctrl+Enter</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={draft}
                    loading={drafting}
                    disabled={!draftPrompt.trim()}
                    data-testid="draft-btn"
                    className="shrink-0"
                  >
                    {drafting ? 'Генерирую…' : 'Сгенерировать код'}
                  </Button>
                </div>
              </div>

              <Field>
                <Label htmlFor="strategy-code">Код стратегии (Python)</Label>
                <Textarea
                  id="strategy-code"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  data-testid="strategy-code"
                  spellCheck={false}
                  className="min-h-[260px] font-mono text-[12.5px] leading-relaxed"
                />
              </Field>

              <Button onClick={execute} loading={running} disabled={universe.length < 1} fullWidth data-testid="run-backtest">
                {running ? 'Прогоняю бэктест…' : 'Запустить бэктест'}
              </Button>
            </CardContent>
          </Card>

          <Card className="flex min-h-[50vh] min-w-0 flex-col">
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
                {canSaveResult && (
                  <Button size="sm" variant="secondary" onClick={openSaveResultModal}>
                    Сохранить результат
                  </Button>
                )}
                {!isFresh && openedRunId != null && !running && (
                  <Button size="sm" variant="secondary" onClick={() => openEditRun(openedRunId)}>
                    Изменить описание
                  </Button>
                )}
              </div>
            </CardHeader>
            <div ref={outRef} className="flex-1 overflow-auto px-5 pb-5 sm:px-6">
              {!hasOutput ? (
                <div className="flex h-full min-h-[36vh] flex-col items-center justify-center text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-fk-pill bg-brand-50 text-brand">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 19V5m0 14h16M8 15l3-4 3 3 4-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-ink">Здесь появится отчёт бэктеста</p>
                  <p className="mt-1 max-w-sm text-sm text-ink-3">
                    Настройте вселенную и стратегию, затем «Запустить бэктест» — кривая капитала vs бенчмарк, метрики
                    (CAGR, Sharpe, просадка), модель издержек по рынку, помесячная доходность и лог сделок.
                  </p>
                </div>
              ) : (
                <div className="research-output" data-testid="backtest-output">
                  {viewDesc && <div className="rdesc" dangerouslySetInnerHTML={{ __html: renderMd(viewDesc) }} />}
                  {liveChart && <div data-testid="equity-chart" dangerouslySetInnerHTML={{ __html: equitySvg(liveChart) }} />}
                  {log && <pre className="rlog">{log}</pre>}
                  {blocks.map((html, i) => (
                    <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
                  ))}
                  {running && blocks.length === 0 && !log && !liveChart && <Skeleton className="h-24 w-full" />}
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>

      <Modal
        open={!!runModal}
        onClose={() => setRunModal(null)}
        title={runModal?.mode === 'edit' ? 'Редактировать прогон' : 'Сохранить результат'}
        description="Название и описание (какую гипотезу проверяли). Описание — Markdown."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunModal(null)}>
              Отмена
            </Button>
            <Button onClick={confirmRunModal} loading={savingResult} disabled={!runModal?.title.trim()}>
              Сохранить
            </Button>
          </>
        }
      >
        {runModal && (
          <div className="space-y-3 pt-1">
            <Input
              autoFocus
              value={runModal.title}
              onChange={(e) => setRunModal({ ...runModal, title: e.target.value })}
              placeholder="Название прогона"
            />
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-2">Описание (Markdown)</span>
              <button type="button" onClick={() => setRunPreview((v) => !v)} className="text-[12px] font-medium text-brand hover:underline">
                {runPreview ? 'Редактировать' : 'Предпросмотр'}
              </button>
            </div>
            {runPreview ? (
              <div className="rdesc max-h-[44vh] overflow-auto rounded-fk border border-line bg-surface-2 px-3 py-2" dangerouslySetInnerHTML={{ __html: renderMd(runModal.description || '_(пусто)_') }} />
            ) : (
              <Textarea
                value={runModal.description}
                onChange={(e) => setRunModal({ ...runModal, description: e.target.value })}
                placeholder={'## Гипотеза\nЧто проверяем…\n\n## Наблюдения\n- доходность vs бенчмарк\n- влияние издержек'}
                className="min-h-[160px] font-mono text-[13px]"
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
