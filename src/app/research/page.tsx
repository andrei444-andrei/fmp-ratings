'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Spinner,
  Textarea,
  ToastProvider,
  useToast,
} from '@/components/ui';

type SavedPrompt = { id: number; title: string | null; prompt: string; created_at: string };

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
  const [saved, setSaved] = useState<SavedPrompt[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [log, setLog] = useState('');
  const outRef = useRef<HTMLDivElement>(null);

  async function loadPrompts() {
    try {
      const r = await fetch('/api/research/prompts');
      const d = await r.json();
      setSaved(Array.isArray(d?.prompts) ? d.prompts : []);
    } catch {
      setSaved([]);
    }
  }
  useEffect(() => {
    loadPrompts();
  }, []);

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight, behavior: 'smooth' });
  }, [blocks, status]);

  async function save() {
    if (!prompt.trim()) return;
    setSaving(true);
    try {
      const r = await fetch('/api/research/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Не удалось сохранить');
      toast({ variant: 'success', title: 'Промт сохранён' });
      loadPrompts();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка сохранения', description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  async function execute() {
    if (!prompt.trim() || running) return;
    setRunning(true);
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
          else if (ev.type === 'log') setLog((l) => l + ev.text);
          else if (ev.type === 'block') setBlocks((b) => [...b, ev.html]);
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

  const hasOutput = blocks.length > 0 || log.length > 0 || running;

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
        {/* Левая колонка — чат/промт */}
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
                <Button variant="secondary" onClick={save} loading={saving} disabled={!prompt.trim()}>
                  Сохранить
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сохранённые промты</CardTitle>
            </CardHeader>
            <CardContent>
              {saved === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : saved.length === 0 ? (
                <p className="text-sm text-ink-3">Пока пусто. Сохрани первый промт кнопкой «Сохранить».</p>
              ) : (
                <ul className="space-y-2">
                  {saved.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPrompt(p.prompt)}
                        className="w-full rounded-fk border border-line bg-surface-elev px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                      >
                        <span className="line-clamp-2 text-sm text-ink">{p.prompt}</span>
                        <span className="mt-1 block text-[11px] text-ink-3 tabular-nums">{p.created_at.slice(0, 10)}</span>
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
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Результат</CardTitle>
            {running ? (
              <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                <Spinner className="text-brand" />
                {status}
              </span>
            ) : status ? (
              <Badge variant={status === 'Ошибка' ? 'down' : 'up'}>{status}</Badge>
            ) : null}
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
                {blocks.map((html, i) => (
                  <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
                ))}
                {log && <pre className="rlog">{log}</pre>}
                {running && blocks.length === 0 && !log && <Skeleton className="h-24 w-full" />}
              </div>
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
