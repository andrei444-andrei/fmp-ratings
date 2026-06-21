'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import { marked } from 'marked';
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
  Select,
  Skeleton,
  Spinner,
  Textarea,
  ToastProvider,
  useToast,
} from '@/components/ui';

hljs.registerLanguage('python', python);

type SavedPrompt = { id: number; title: string | null; prompt: string; created_at: string };
type SavedRunItem = { id: number; prompt_id: number | null; title: string | null; created_at: string };

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

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function renderMd(md: string): string {
  try {
    return marked.parse(md || '', { async: false, breaks: true }) as string;
  } catch {
    return esc(md);
  }
}

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4L18 10a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16v4z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [model, setModel] = useState('');

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [log, setLog] = useState('');
  const [isFresh, setIsFresh] = useState(false); // свежий прогон (можно сохранить результат)
  // К какому СОХРАНЁННОМУ промту относится текущий текст (результат привязывается к нему).
  const [activePrompt, setActivePrompt] = useState<{ id: number; title: string } | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  // Модалка сохранения/редактирования результата (название + описание Markdown).
  const [runModal, setRunModal] = useState<
    { mode: 'save' | 'edit'; id?: number; title: string; description: string } | null
  >(null);
  const [runPreview, setRunPreview] = useState(false);
  // Описание/идентификатор открытого сохранённого результата.
  const [viewDesc, setViewDesc] = useState<string | null>(null);
  const [viewRunId, setViewRunId] = useState<number | null>(null);
  // Голосовой ввод (Web Speech API).
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recogRef = useRef<any>(null);
  const dictBaseRef = useRef('');
  const dictFinalRef = useRef('');

  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMicSupported(
      typeof window !== 'undefined' &&
        !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    );
  }, []);

  function toggleMic() {
    if (listening) {
      recogRef.current?.stop?.();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast({ variant: 'error', title: 'Голосовой ввод не поддерживается этим браузером' });
      return;
    }
    const r = new SR();
    r.lang = 'ru-RU';
    r.continuous = true;
    r.interimResults = true;
    dictBaseRef.current = prompt ? prompt.replace(/\s+$/, '') + ' ' : '';
    dictFinalRef.current = '';
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) dictFinalRef.current += t + ' ';
        else interim += t;
      }
      setPrompt((dictBaseRef.current + dictFinalRef.current + interim).replace(/\s{2,}/g, ' '));
    };
    r.onerror = (e: any) => {
      if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        toast({ variant: 'error', title: 'Ошибка микрофона', description: String(e.error) });
      }
      setListening(false);
    };
    r.onend = () => {
      setListening(false);
      recogRef.current = null;
    };
    recogRef.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }

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
    (async () => {
      try {
        const d = await (await fetch('/api/research/models')).json();
        setModels(Array.isArray(d?.models) ? d.models : []);
      } catch {
        setModels([]);
      }
    })();
    try {
      const saved = localStorage.getItem('codeModel');
      if (saved) setModel(saved);
    } catch {
      /* нет localStorage */
    }
    // Пермалинк: ?run=<id> — открываем сохранённый результат напрямую по ссылке.
    try {
      const v = new URLSearchParams(window.location.search).get('run');
      const n = Number(v);
      if (v && Number.isInteger(n) && n > 0) openSavedRun(n);
    } catch {
      /* нет window — игнор */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('codeModel', model);
    } catch {
      /* нет localStorage */
    }
  }, [model]);
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
      setActivePrompt({ id: Number(d.id), title });
      toast({ variant: 'success', title: 'Исследование сохранено' });
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

  function openSaveResultModal() {
    if (!activePrompt) return;
    const sp = (savedPrompts ?? []).find((p) => p.id === activePrompt.id);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setRunModal({ mode: 'save', title: `${sp?.title || 'Результат'} · ${ts}`, description: '' });
    setRunPreview(false);
  }

  async function openEditRun(id: number) {
    try {
      const d = await (await fetch(`/api/research/runs/${id}`)).json();
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
        if (!activePrompt) throw new Error('нет активного промта');
        const resultHtml = buildResultHtml();
        if (!resultHtml) throw new Error('нечего сохранять');
        const r = await fetch('/api/research/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ promptId: activePrompt.id, prompt: prompt.trim(), code, resultHtml, title: runModal.title.trim(), description: runModal.description }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить результат');
        if (d?.id) {
          reflectRunId(Number(d.id)); // теперь у результата есть постоянная ссылка
          setIsFresh(false); // это уже сохранённый снимок, а не свежий прогон
        }
        toast({ variant: 'success', title: 'Результат сохранён', description: 'Ссылка — в адресной строке (кнопка 🔗)' });
      } else {
        const r = await fetch(`/api/research/runs/${runModal.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: runModal.title.trim(), description: runModal.description }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить');
        toast({ variant: 'success', title: 'Изменения сохранены' });
        if (viewRunId === runModal.id) setViewDesc(runModal.description || null);
      }
      setRunModal(null);
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка сохранения', description: e?.message });
    } finally {
      setSavingResult(false);
    }
  }

  // Пермалинк результата: ?run=<id> в адресной строке (без навигации) — ссылку можно скопировать/открыть.
  function reflectRunId(id: number | null) {
    setViewRunId(id);
    try {
      const url = new URL(window.location.href);
      if (id != null) url.searchParams.set('run', String(id));
      else url.searchParams.delete('run');
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* нет window/URL — игнор */
    }
  }
  async function copyRunLink(id: number) {
    const url = `${window.location.origin}/research?run=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ variant: 'success', title: 'Ссылка скопирована', description: url });
    } catch {
      // clipboard недоступен (insecure context) — показываем ссылку, чтобы скопировать вручную.
      toast({ variant: 'info', title: 'Ссылка на результат', description: url });
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
      setViewDesc(run.description || null);
      reflectRunId(run.id); // адресная строка → пермалинк на этот результат
      setStatus('Сохранённый результат');
      // Подгружаем входной промт результата (привязка к его промту).
      setPrompt(run.prompt || '');
      const studyTitle = (savedPrompts ?? []).find((sp) => sp.id === run.prompt_id)?.title || 'Исследование';
      setActivePrompt(run.prompt_id ? { id: run.prompt_id, title: studyTitle } : null);
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }

  async function onDeletePrompt(id: number) {
    try {
      const r = await fetch(`/api/research/prompts/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Ошибка');
      if (activePrompt?.id === id) setActivePrompt(null);
      toast({ variant: 'success', title: 'Исследование и его результаты удалены' });
      loadPrompts();
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось удалить', description: e?.message });
    }
  }

  async function onDeleteRun(id: number) {
    try {
      const r = await fetch(`/api/research/runs/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Ошибка');
      toast({ variant: 'success', title: 'Результат удалён' });
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось удалить', description: e?.message });
    }
  }

  function newStudy() {
    setActivePrompt(null);
    setPrompt('');
    setCode('');
    setBlocks([]);
    setLog('');
    setViewDesc(null);
    reflectRunId(null);
    setIsFresh(false);
    setStatus('');
  }

  async function execute() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setIsFresh(true);
    setCode('');
    setBlocks([]);
    setLog('');
    setViewDesc(null);
    reflectRunId(null); // свежий прогон — ещё не сохранён, убираем устаревший ?run
    setStatus('Отправка запроса…');
    try {
      const res = await fetch('/api/research/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), model: model || undefined }),
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
  // Результаты, сгруппированные по промту (вкладываем под каждый промт).
  const runsByPrompt = useMemo(() => {
    const m = new Map<number, SavedRunItem[]>();
    for (const r of savedRuns ?? []) {
      if (r.prompt_id == null) continue;
      const arr = m.get(r.prompt_id) ?? [];
      arr.push(r);
      m.set(r.prompt_id, arr);
    }
    return m;
  }, [savedRuns]);

  const hasFreshOutput = blocks.length > 0 || log.length > 0;
  // Результат можно сохранить, только если текущий текст — это сохранённый промт.
  const canSaveResult = isFresh && !running && hasFreshOutput && !!activePrompt;
  const showSaveHint = isFresh && !running && hasFreshOutput && !activePrompt;

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
              {activePrompt && (
                <div className="flex items-center justify-between gap-2 rounded-fk bg-brand-50 px-3 py-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-brand-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
                      <path d="M9 3v6l-5.2 8.3A2 2 0 0 0 5.5 20.5h13a2 2 0 0 0 1.7-3.2L15 9V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9 3h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <span className="truncate">Исследование: {activePrompt.title}</span>
                  </span>
                  <button type="button" onClick={newStudy} className="shrink-0 text-[12px] font-medium text-brand hover:underline">
                    Новое
                  </button>
                </div>
              )}
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Напр.: сравни доходность AAPL и MSFT за год и покажи просадки"
                style={{ minHeight: 200 }}
              />
              {micSupported && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-ink-3">
                    {listening ? 'Слушаю… говорите' : 'Можно надиктовать голосом'}
                  </span>
                  <Button size="sm" variant={listening ? 'danger' : 'ghost'} onClick={toggleMic} leftIcon={<MicIcon />}>
                    {listening ? 'Стоп' : 'Голос'}
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={execute} loading={running} disabled={!prompt.trim()} fullWidth>
                  {running ? 'Выполняется…' : 'Исполнить'}
                </Button>
                <Button variant="secondary" onClick={() => setSaveOpen(true)} disabled={!prompt.trim()}>
                  {activePrompt ? 'Сохранить как новое' : 'Сохранить исследование'}
                </Button>
              </div>
              {models.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[12px] text-ink-3">Модель кода:</span>
                  <Select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Модель кода">
                    <option value="">По умолчанию (Opus)</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Исследования</CardTitle>
              <CardDescription>Исследование = запрос + сохранённые к нему результаты. Кликните, чтобы провалиться внутрь.</CardDescription>
            </CardHeader>
            <CardContent>
              {savedPrompts === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : savedPrompts.length === 0 ? (
                <p className="text-sm text-ink-3">Пока пусто. Создайте первое исследование — с названием.</p>
              ) : (
                <ul className="space-y-3" data-testid="saved-prompts">
                  {savedPrompts.map((p) => {
                    const runs = runsByPrompt.get(p.id) ?? [];
                    return (
                      <li key={p.id} className="rounded-fk border border-line bg-surface-elev">
                        <div className="flex items-stretch gap-1 p-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt(p.prompt);
                              setActivePrompt({ id: p.id, title: p.title || 'Без названия' });
                            }}
                            className="min-w-0 flex-1 rounded-fk-sm px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                          >
                            <span className="block truncate text-sm font-semibold text-ink">{p.title || 'Без названия'}</span>
                            <span className="mt-0.5 line-clamp-1 text-[12px] text-ink-3">{p.prompt}</span>
                          </button>
                          <button
                            type="button"
                            aria-label="Удалить исследование"
                            title="Удалить исследование и его результаты"
                            onClick={() => onDeletePrompt(p.id)}
                            className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-down focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                        {runs.length > 0 && (
                          <ul className="space-y-1 border-t border-line px-2 pb-2 pt-1.5">
                            {runs.map((r) => (
                              <li key={r.id} className="flex items-stretch gap-1">
                                <button
                                  type="button"
                                  data-testid="run-open"
                                  onClick={() => openSavedRun(r.id)}
                                  className="min-w-0 flex-1 rounded-fk-sm px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                                >
                                  <span className="flex items-center gap-2">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-ink-3">
                                      <path d="M4 19V5m0 14h16M8 15l3-4 3 3 4-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{r.title || `Результат #${r.id}`}</span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  aria-label="Скопировать ссылку"
                                  title="Скопировать ссылку на результат"
                                  data-testid="run-copy"
                                  onClick={() => copyRunLink(r.id)}
                                  className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                                >
                                  🔗
                                </button>
                                <button
                                  type="button"
                                  aria-label="Редактировать результат"
                                  title="Изменить название и описание"
                                  onClick={() => openEditRun(r.id)}
                                  className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                                >
                                  <EditIcon />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Удалить результат"
                                  title="Удалить результат"
                                  onClick={() => onDeleteRun(r.id)}
                                  className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-down focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                                >
                                  <TrashIcon />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
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
                <Button size="sm" variant="secondary" onClick={openSaveResultModal}>
                  Сохранить результат
                </Button>
              )}
              {showSaveHint && (
                <span className="text-[12px] text-ink-3">Создайте исследование, чтобы сохранить результат</span>
              )}
              {viewRunId != null && !running && (
                <Button size="sm" variant="ghost" onClick={() => copyRunLink(viewRunId)} data-testid="run-copy-link">
                  🔗 Ссылка
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
                <p className="text-sm font-medium text-ink">Здесь появится анализ</p>
                <p className="mt-1 max-w-xs text-sm text-ink-3">Введите запрос слева и нажмите «Исполнить» — результат соберётся по ходу выполнения.</p>
              </div>
            ) : (
              <div className="research-output">
                {viewDesc && <div className="rdesc" dangerouslySetInnerHTML={{ __html: renderMd(viewDesc) }} />}
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
        title="Сохранить исследование"
        description="Назовите исследование — по нему найдёте его и его результаты."
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

      <Modal
        open={!!runModal}
        onClose={() => setRunModal(null)}
        title={runModal?.mode === 'edit' ? 'Редактировать результат' : 'Сохранить результат'}
        description="Название и описание (какая логика тестировалась). Описание — Markdown: ## заголовки, списки, **жирный**."
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
              placeholder="Название результата"
            />
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-2">Описание (Markdown)</span>
              <button
                type="button"
                onClick={() => setRunPreview((v) => !v)}
                className="text-[12px] font-medium text-brand hover:underline"
              >
                {runPreview ? 'Редактировать' : 'Предпросмотр'}
              </button>
            </div>
            {runPreview ? (
              <div
                className="rdesc max-h-[44vh] overflow-auto rounded-fk border border-line bg-surface-2 px-3 py-2"
                dangerouslySetInnerHTML={{ __html: renderMd(runModal.description || '_(пусто)_') }}
              />
            ) : (
              <Textarea
                value={runModal.description}
                onChange={(e) => setRunModal({ ...runModal, description: e.target.value })}
                placeholder={'## Гипотеза\nЧто проверяем…\n\n## Метод\n- снимки раз в месяц\n- 5 групп по моментуму\n\n## Выводы\n…'}
                className="min-h-[180px] font-mono text-[13px]"
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
