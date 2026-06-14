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
  Input,
  Label,
  Modal,
  Select,
  Skeleton,
  Spinner,
  Textarea,
  ToastProvider,
  useToast,
} from '@/components/ui';
import {
  DEFAULT_BASE_SIGNALS,
  UNIVERSE_PRESETS,
  type UniversePreset,
} from '@/lib/signals/presets';

type SavedRunItem = { id: number; title: string | null; created_at: string };

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

const HORIZONS = [
  { v: 5, label: '1 неделя (5 дней)' },
  { v: 10, label: '2 недели (10 дней)' },
  { v: 21, label: '1 месяц (21 день)' },
];
const FDRS = [
  { v: 0.05, label: 'FDR 0.05 (строго)' },
  { v: 0.1, label: 'FDR 0.10 (баланс)' },
  { v: 0.2, label: 'FDR 0.20 (мягко)' },
];

export default function SignalsPage() {
  return (
    <ToastProvider>
      <Signals />
    </ToastProvider>
  );
}

function Signals() {
  const { toast } = useToast();

  // ── Конфиг ──
  const [presets, setPresets] = useState<Set<UniversePreset>>(new Set(['broad']));
  const [custom, setCustom] = useState('');
  const [benchmark, setBenchmark] = useState('SPY');
  const [horizon, setHorizon] = useState(5);
  const [fdr, setFdr] = useState(0.1);
  const [minTrain, setMinTrain] = useState(52);

  // ── Прогон ──
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [log, setLog] = useState('');
  const [isFresh, setIsFresh] = useState(false);
  const [viewDesc, setViewDesc] = useState<string | null>(null);
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
      if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) set.add(s);
    }
    set.delete(benchmark.toUpperCase().trim());
    return [...set];
  }, [presets, custom, benchmark]);

  async function loadRuns() {
    try {
      const d = await (await fetch('/api/signals/runs')).json();
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

  function togglePreset(id: UniversePreset) {
    setPresets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildResultHtml(): string {
    const logHtml = log ? `<pre class="rlog">${esc(log)}</pre>` : '';
    return logHtml + blocks.join('');
  }

  async function execute() {
    if (running) return;
    if (universe.length < 4) {
      toast({ variant: 'error', title: 'Маловата вселенная', description: 'Нужно ≥ 4 инструментов — добавьте пресет или тикеры.' });
      return;
    }
    const config = {
      universe,
      benchmark: benchmark.toUpperCase().trim() || 'SPY',
      horizonDays: horizon,
      stepDays: horizon,
      fdrAlpha: fdr,
      walkforwardMinTrain: minTrain,
      baseSignals: DEFAULT_BASE_SIGNALS,
    };
    lastConfigRef.current = config;
    setRunning(true);
    setIsFresh(true);
    setBlocks([]);
    setLog('');
    setViewDesc(null);
    setStatus('Отправка запроса…');
    try {
      const res = await fetch('/api/signals/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config }),
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
          else if (ev.type === 'block') setBlocks((b) => [...b, ev.html]);
          else if (ev.type === 'log') setLog((l) => l + ev.text);
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
    setRunModal({ mode: 'save', title: `Модель сигналов · ${ts}`, description: '' });
    setRunPreview(false);
  }

  async function openEditRun(id: number) {
    try {
      const d = await (await fetch(`/api/signals/runs/${id}`)).json();
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
        const r = await fetch('/api/signals/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resultHtml,
            title: runModal.title.trim(),
            description: runModal.description,
            config: lastConfigRef.current,
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить результат');
        toast({ variant: 'success', title: 'Результат сохранён', description: d?.title });
      } else {
        const r = await fetch(`/api/signals/runs/${runModal.id}`, {
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
      const d = await (await fetch(`/api/signals/runs/${id}`)).json();
      const run = d?.run;
      if (!run) throw new Error('Результат не найден');
      setRunning(false);
      setIsFresh(false);
      setLog('');
      setBlocks(run.result_html ? [run.result_html] : []);
      setViewDesc(run.description || null);
      setStatus('Сохранённый результат');
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }

  async function onDeleteRun(id: number) {
    try {
      const r = await fetch(`/api/signals/runs/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Ошибка');
      toast({ variant: 'success', title: 'Результат удалён' });
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось удалить', description: e?.message });
    }
  }

  const hasOutput = blocks.length > 0 || log.length > 0 || running;
  const canSaveResult = isFresh && !running && (blocks.length > 0 || log.length > 0);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-[rgba(255,255,255,0.82)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3 sm:px-6">
          <span className="h-7 w-7 rounded-fk-sm bg-gradient-to-br from-brand to-[#9b8cff] shadow-[0_4px_14px_rgba(109,91,240,0.45)]" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-ink">Модель сигналов</div>
            <div className="text-[11px] text-ink-3">Факторная модель · значимость · веса · OOS</div>
          </div>
          <div className="ml-auto">
            <Badge variant="brand">beta</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[380px_1fr] lg:py-8">
        {/* Левая колонка — конфиг */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Конфигурация</CardTitle>
              <CardDescription>
                База — моментум-экстремумы; вторичные факторы (SMA, волатильность, расстояние от ATH) модулируют
                ожидаемую избыточную доходность. Значимость — с FDR-поправкой.
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
                  placeholder="напр.: SMH, GLD, TLT"
                  style={{ minHeight: 64 }}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label htmlFor="benchmark">Бенчмарк</Label>
                  <Input id="benchmark" value={benchmark} onChange={(e) => setBenchmark(e.target.value)} placeholder="SPY" />
                </Field>
                <Field>
                  <Label htmlFor="horizon">Горизонт таргета</Label>
                  <Select id="horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                    {HORIZONS.map((h) => (
                      <option key={h.v} value={h.v}>
                        {h.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label htmlFor="fdr">Значимость (FDR)</Label>
                  <Select id="fdr" value={fdr} onChange={(e) => setFdr(Number(e.target.value))}>
                    {FDRS.map((f) => (
                      <option key={f.v} value={f.v}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field>
                  <Label htmlFor="mintrain">Walk-forward: min train (периодов)</Label>
                  <Input
                    id="mintrain"
                    type="number"
                    value={minTrain}
                    min={8}
                    max={520}
                    onChange={(e) => setMinTrain(Number(e.target.value) || 52)}
                  />
                </Field>
              </div>

              <Field>
                <Label>Базовые сигналы (триггеры режима)</Label>
                <ul className="space-y-1.5">
                  {DEFAULT_BASE_SIGNALS.map((s) => (
                    <li key={s.name} className="flex items-center gap-2 rounded-fk border border-line bg-surface-2 px-3 py-1.5 text-[12px] text-ink-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-fk-pill bg-brand" />
                      {s.name}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-3">Кодируют найденные паттерны: моментум-экстремумы, превышение бенчмарка, волатильность, близость к ATH.</p>
              </Field>

              <Button onClick={execute} loading={running} disabled={universe.length < 4} fullWidth data-testid="run-signals">
                {running ? 'Считаю модель…' : 'Построить модель'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сохранённые прогоны</CardTitle>
              <CardDescription>Снимок отчёта + конфиг. Кликните, чтобы открыть.</CardDescription>
            </CardHeader>
            <CardContent>
              {savedRuns === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : savedRuns.length === 0 ? (
                <p className="text-sm text-ink-3">Пока пусто. Постройте модель и сохраните результат.</p>
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

        {/* Правая колонка — результат */}
        <Card className="flex min-h-[60vh] min-w-0 flex-col">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Отчёт модели</CardTitle>
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
            </div>
          </CardHeader>
          <div ref={outRef} className="flex-1 overflow-auto px-5 pb-5 sm:px-6">
            {!hasOutput ? (
              <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-fk-pill bg-brand-50 text-brand">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 19V5m0 14h16M8 15l3-4 3 3 4-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-ink">Здесь появится отчёт модели</p>
                <p className="mt-1 max-w-sm text-sm text-ink-3">
                  Настройте вселенную и горизонт слева, затем «Построить модель» — IC факторов, базовые сигналы,
                  модуляция, коллинеарность, веса, walk-forward OOS и live-скоринг соберутся по ходу.
                </p>
              </div>
            ) : (
              <div className="research-output" data-testid="signals-output">
                {viewDesc && <div className="rdesc" dangerouslySetInnerHTML={{ __html: renderMd(viewDesc) }} />}
                {log && <pre className="rlog">{log}</pre>}
                {blocks.map((html, i) => (
                  <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
                ))}
                {running && blocks.length === 0 && !log && <Skeleton className="h-24 w-full" />}
              </div>
            )}
          </div>
        </Card>
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
                placeholder={'## Гипотеза\nЧто проверяем…\n\n## Наблюдения\n- сильные факторы\n- что значимо по FDR'}
                className="min-h-[160px] font-mono text-[13px]"
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
