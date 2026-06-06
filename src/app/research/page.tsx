'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Textarea,
  ToastProvider,
  useToast,
} from '@/components/ui';

hljs.registerLanguage('python', python);

type SavedPrompt = { id: number; title: string | null; prompt: string; created_at: string };
type SavedRunItem = { id: number; title: string | null; created_at: string };

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}

function CodeBlock({ code }: { code: string }) {
  const html = useMemo(() => {
    try {
      return hljs.highlight(code, { language: 'python' }).value;
    } catch {
      return esc(code);
    }
  }, [code]);
  return (
    <div className="rblk">
      <div className="rcap">Python-скрипт</div>
      <pre className="rcode">
        <code className="hljs language-python" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <ToastProvider>
      <Research />
    </ToastProvider>
  );
}

function Research() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[] | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRunItem[] | null>(null);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [log, setLog] = useState('');
  const [isFresh, setIsFresh] = useState(false); // свежий прогон (можно сохранить результат)
  // К какому СОХРАНЁННОМУ промту относится текущий текст (результат привязывается к нему).
  const [activePrompt, setActivePrompt] = useState<{ id: number; text: string } | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingResult, setSavingResult] = useState(false);

  const outRef = useRef<HTMLDivElement>(null);

  async function loadPrompts() {
    try {
      const d = await (await fetch('/api/research/prompts')).json();
      setSavedPrompts(Array.isArray(d?.prompts) ? d.prompts : []);
    } catch {
      setSavedPrompts([]);
    }
  }
  async function loadRuns() {
    try {
      const d = await (await fetch('/api/research/runs')).json();
      setSavedRuns(Array.isArray(d?.runs) ? d.runs : []);
    } catch {
      setSavedRuns([]);
    }
  }
  useEffect(() => {
    loadPrompts();
    loadRuns();
  }, []);
  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight, behavior: 'smooth' });
  }, [blocks, log, status, code]);

  async function confirmSavePrompt() {
    const title = titleInput.trim();
    if (!title || !prompt.trim()) return;
    setSavingPrompt(true);
    try {
      const r = await fetch('/api/research/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), title }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить');
      setActivePrompt({ id: Number(d.id), text: prompt.trim() });
      toast({ variant: 'success', title: 'Промт сохранён' });
      setSaveOpen(false);
      setTitleInput('');
      loadPrompts();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка сохранения', description: e?.message });
    } finally {
      setSavingPrompt(false);
    }
  }

  function buildResultHtml(): string {
    const logHtml = log ? `<pre class="rlog">${esc(log)}</pre>` : '';
    return logHtml + blocks.join('');
  }

  async function saveResult() {
    if (!activePrompt) return;
    const resultHtml = buildResultHtml();
    if (!resultHtml) return;
    setSavingResult(true);
    try {
      const r = await fetch('/api/research/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ promptId: activePrompt.id, code, resultHtml }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить результат');
      toast({ variant: 'success', title: 'Результат сохранён', description: d?.title });
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка сохранения', description: e?.message });
    } finally {
      setSavingResult(false);
    }
  }

  async function openSavedRun(id: number) {
    try {
      const d = await (await fetch(`/api/research/runs/${id}`)).json();
      const run = d?.run;
      if (!run) throw new Error('Результат не найден');
      setRunning(false);
      setIsFresh(false);
      setCode(run.code || '');
      setLog('');
      setBlocks(run.result_html ? [run.result_html] : []);
      setStatus('Сохранённый результат');
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }

  async function execute() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setIsFresh(true);
    setCode('');
    setBlocks([]);
    setLog('');
    setStatus('Отправка запроса…');
    try {
      const res = await fetch('/api/research/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
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
          else if (ev.type === 'code') setCode(ev.code);
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

  const hasOutput = code.length > 0 || blocks.length > 0 || log.length > 0 || running;
  const hasFreshOutput = blocks.length > 0 || log.length > 0;
  // Результат можно сохранить, только если текущий текст — это сохранённый промт.
  const promptSaved = !!activePrompt && activePrompt.text === prompt.trim();
  const canSaveResult = isFresh && !running && hasFreshOutput && promptSaved;
  const showSaveHint = isFresh && !running && hasFreshOutput && !promptSaved;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-[rgba(255,255,255,0.82)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3 sm:px-6">
          <span className="h-7 w-7 rounded-fk-sm bg-gradient-to-br from-brand to-[#9b8cff] shadow-[0_4px_14px_rgba(109,91,240,0.45)]" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-ink">Исследование трендов</div>
            <div className="text-[11px] text-ink-3">AI-аналитика рынков</div>
          </div>
          <div className="ml-auto">
            <Badge variant="brand">beta</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[380px_1fr] lg:py-8">
        {/* Левая колонка */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Запрос</CardTitle>
              <CardDescription>Опишите, какой тренд исследовать. Тикеры — заглавными (AAPL, MSFT…).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Напр.: сравни доходность AAPL и MSFT за год и покажи просадки"
              />
              <div className="flex gap-2">
                <Button onClick={execute} loading={running} disabled={!prompt.trim()} fullWidth>
                  {running ? 'Выполняется…' : 'Исполнить'}
                </Button>
                <Button variant="secondary" onClick={() => setSaveOpen(true)} disabled={!prompt.trim()}>
                  Сохранить промт
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сохранённые промты</CardTitle>
            </CardHeader>
            <CardContent>
              {savedPrompts === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : savedPrompts.length === 0 ? (
                <p className="text-sm text-ink-3">Пока пусто. Сохрани первый промт — с названием.</p>
              ) : (
                <ul className="space-y-2">
                  {savedPrompts.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPrompt(p.prompt)}
                        className="w-full rounded-fk border border-line bg-surface-elev px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                      >
                        <span className="block truncate text-sm font-semibold text-ink">{p.title || 'Без названия'}</span>
                        <span className="mt-0.5 line-clamp-1 text-[12px] text-ink-3">{p.prompt}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сохранённые результаты</CardTitle>
            </CardHeader>
            <CardContent>
              {savedRuns === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : savedRuns.length === 0 ? (
                <p className="text-sm text-ink-3">Сохрани результат прогона кнопкой «Сохранить результат».</p>
              ) : (
                <ul className="space-y-2" data-testid="saved-runs">
                  {savedRuns.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => openSavedRun(r.id)}
                        className="w-full rounded-fk border border-line bg-surface-elev px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                      >
                        <span className="block truncate text-sm font-medium text-ink">{r.title || `Результат #${r.id}`}</span>
                        <span className="mt-0.5 block text-[11px] tabular-nums text-ink-3">{r.created_at.slice(0, 16).replace('T', ' ')}</span>
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
              {canSaveResult && (
                <Button size="sm" variant="secondary" onClick={saveResult} loading={savingResult}>
                  Сохранить результат
                </Button>
              )}
              {showSaveHint && (
                <span className="text-[12px] text-ink-3">Сохраните промт, чтобы сохранить результат</span>
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
                <p className="text-sm font-medium text-ink">Здесь появится анализ</p>
                <p className="mt-1 max-w-xs text-sm text-ink-3">Введите запрос слева и нажмите «Исполнить» — результат соберётся по ходу выполнения.</p>
              </div>
            ) : (
              <div className="research-output">
                {code && <CodeBlock code={code} />}
                {log && <pre className="rlog">{log}</pre>}
                {blocks.map((html, i) => (
                  <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
                ))}
                {running && !code && blocks.length === 0 && !log && <Skeleton className="h-24 w-full" />}
              </div>
            )}
          </div>
        </Card>
      </main>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Сохранить промт"
        description="Дайте промту понятное название — по нему найдёте его в списке."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Отмена
            </Button>
            <Button onClick={confirmSavePrompt} loading={savingPrompt} disabled={!titleInput.trim()}>
              Сохранить
            </Button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <Input
            autoFocus
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && titleInput.trim() && confirmSavePrompt()}
            placeholder="Название, напр.: «Просадки QQQ и форвардная доходность»"
          />
          <p className="line-clamp-2 text-[13px] text-ink-3">{prompt}</p>
        </div>
      </Modal>
    </>
  );
}
