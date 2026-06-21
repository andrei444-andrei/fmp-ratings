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

// Сохранённые сущности бэктеста: стратегии (переиспользуемый код) и прогоны (результаты).
type ChatMsg = { role: 'user' | 'assistant'; content: string };
type SavedStrategyItem = { id: number; title: string | null; created_at: string };
type SavedRunItem = {
  id: number;
  strategy_id: number | null;
  title: string | null;
  autosaved: boolean;
  created_at: string;
};

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
const DRAFT_KEY = 'bt:draft:code'; // автосохранение черновика кода в localStorage (не теряем правки)

// Тикеры стратегии задаются в самом скрипте: переменная верхнего уровня UNIVERSE = [...] (или SYMBOLS).
// Парсим её на клиенте — чтобы показать состав и не блокировать запуск, когда вселенная задана в коде.
function parseScriptUniverse(code: string): string[] {
  const m = code.match(/\b(?:UNIVERSE|SYMBOLS)\s*=\s*\[([^\]]*)\]/);
  if (!m) return [];
  const out = new Set<string>();
  const re = /["']([A-Za-z0-9.\-]{1,12})["']/g;
  let g: RegExpExecArray | null;
  while ((g = re.exec(m[1]))) {
    const s = g[1].toUpperCase().trim();
    if (SYMBOL_RE.test(s)) out.add(s);
  }
  return [...out];
}
// Скрипт объявляет вселенную (пусть даже вычисляемую) — тогда поля вселенной в UI лишь запасные.
function hasScriptUniverse(code: string): boolean {
  return /\b(?:UNIVERSE|SYMBOLS)\s*=/.test(code);
}

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

// Короткая метка времени из ISO created_at (для списка автосохранений).
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function autoStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// Сборка HTML результата (кривая + лог + блоки) — общая для ручного сохранения и автосохранения.
function composeResultHtml(chart: EquityPayload | null, logStr: string, blks: string[]): string {
  const logHtml = logStr ? `<pre class="rlog">${esc(logStr)}</pre>` : '';
  const chartHtml = chart ? equitySvg(chart) : '';
  return chartHtml + logHtml + blks.join('');
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
  // По умолчанию пресеты не выбраны: вселенная задаётся в скрипте (UNIVERSE), пресеты/свои тикеры — запасной путь.
  const [presets, setPresets] = useState<Set<string>>(new Set());
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
  const [draftRestored, setDraftRestored] = useState(false);
  // AI-чат: многошаговый диалог о стратегии. Код из ответа применяется в редактор; история сохраняется со стратегией.
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  // Активная (открытая) сохранённая стратегия — к ней привязываются результаты прогонов.
  const [activeStrategyId, setActiveStrategyId] = useState<number | null>(null);
  const [activeStrategyTitle, setActiveStrategyTitle] = useState<string | null>(null);
  const activeStrategyIdRef = useRef<number | null>(null);
  activeStrategyIdRef.current = activeStrategyId;
  // Чат привязан к стратегии: пишем его в стратегию автоматически. Этот флаг гасит автосохранение,
  // когда чат МЕНЯЕМ программно (открыли стратегию/прогон) — чтобы не перезаписать загруженный тред.
  const suppressChatPersist = useRef(false);

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

  // ── Библиотека (стратегии + прогоны) ──
  const [strategies, setStrategies] = useState<SavedStrategyItem[] | null>(null);
  const [runs, setRuns] = useState<SavedRunItem[] | null>(null);
  const [runModal, setRunModal] = useState<
    { mode: 'save' | 'edit'; id?: number; title: string; description: string } | null
  >(null);
  const [runPreview, setRunPreview] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [strategyModal, setStrategyModal] = useState<{ mode: 'save' | 'rename'; id?: number; title: string } | null>(null);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [suggestingName, setSuggestingName] = useState(false);

  const outRef = useRef<HTMLDivElement>(null);

  // Вселенная из UI (пресеты + свои тикеры) — запасной вариант, если в скрипте нет UNIVERSE.
  // Бенчмарк НЕ вырезаем: его можно одновременно торговать и сравнивать (таймер на QQQ vs buy & hold QQQ).
  const uiUniverse = useMemo(() => {
    const set = new Set<string>();
    for (const p of UNIVERSE_PRESETS) {
      if (presets.has(p.id)) for (const t of p.tickers) set.add(t);
    }
    for (const t of custom.split(/[\s,;]+/)) {
      const s = t.toUpperCase().trim();
      if (SYMBOL_RE.test(s)) set.add(s);
    }
    return [...set];
  }, [presets, custom]);

  // Источник правды по тикерам — скрипт. UI-вселенная используется, только если в коде нет UNIVERSE.
  const scriptUniverse = useMemo(() => parseScriptUniverse(strategy), [strategy]);
  const scriptDriven = useMemo(() => hasScriptUniverse(strategy), [strategy]);
  const universe = scriptUniverse.length ? scriptUniverse : uiUniverse;
  // Кнопку запуска не блокируем, если вселенная объявлена в скрипте (даже вычисляемая).
  const canRun = universe.length >= 1 || scriptDriven;

  // Прогоны вложены ВНУТРЬ своей стратегии (история прогонов = история стратегии). Авто и ручные — вместе.
  const runsByStrategy = useMemo(() => {
    const m = new Map<number, SavedRunItem[]>();
    for (const r of runs ?? []) {
      if (r.strategy_id == null) continue;
      const arr = m.get(r.strategy_id) ?? [];
      arr.push(r);
      m.set(r.strategy_id, arr);
    }
    return m;
  }, [runs]);
  // Легаси-прогоны без стратегии (новые всегда привязаны: при прогоне без активной стратегии она авто-создаётся).
  const orphanRuns = useMemo(() => (runs ?? []).filter((r) => r.strategy_id == null), [runs]);

  async function loadStrategies() {
    try {
      const d = await (await fetch('/api/backtest/strategies')).json();
      setStrategies(Array.isArray(d?.strategies) ? d.strategies : []);
    } catch {
      setStrategies([]);
    }
  }
  async function loadRuns() {
    try {
      const d = await (await fetch('/api/backtest/runs')).json();
      setRuns(Array.isArray(d?.runs) ? d.runs : []);
    } catch {
      setRuns([]);
    }
  }
  useEffect(() => {
    loadStrategies();
    loadRuns();
    // Пермалинк: ?run=<id> открывает сохранённый прогон, ?strategy=<id> — стратегию (по прямой ссылке).
    try {
      const sp = new URLSearchParams(window.location.search);
      const runId = Number(sp.get('run'));
      const stratId = Number(sp.get('strategy'));
      if (sp.get('run') && Number.isInteger(runId) && runId > 0) openSavedRun(runId);
      else if (sp.get('strategy') && Number.isInteger(stratId) && stratId > 0) openStrategy(stratId);
    } catch {
      /* нет window — игнор */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Черновик кода: восстанавливаем из localStorage при загрузке, чтобы не терять правки.
  useEffect(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d && d.trim() && d !== DEFAULT_STRATEGY) {
        setStrategy(d);
        setDraftRestored(true);
      }
    } catch {
      /* localStorage недоступен — не критично */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Автосохранение черновика кода (с дебаунсом) — текущий код редактора всегда восстановим.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, strategy);
      } catch {
        /* noop */
      }
    }, 600);
    return () => clearTimeout(id);
  }, [strategy]);

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight, behavior: 'smooth' });
  }, [blocks, log, status]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatBusy]);

  // Чат — единый тред стратегии: любое изменение автоматически сохраняем в активную стратегию
  // (debounce). Программные загрузки треда гасятся флагом suppressChatPersist, прогоны его не трогают.
  useEffect(() => {
    if (suppressChatPersist.current) {
      suppressChatPersist.current = false;
      return;
    }
    const sid = activeStrategyIdRef.current;
    if (sid == null) return;
    const t = setTimeout(() => {
      fetch(`/api/backtest/strategies/${sid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat: chatMessages.slice(-80) }),
      }).catch(() => {
        /* автосохранение чата не должно мешать работе */
      });
    }, 700);
    return () => clearTimeout(t);
  }, [chatMessages]);

  function togglePreset(id: string) {
    setPresets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildResultHtml(): string {
    return composeResultHtml(liveChart, log, blocks);
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

  // Применяем сохранённый конфиг стратегии к полям UI (бенчмарк/капитал/риск/даты + запасная вселенная).
  function applyConfig(cfg: any) {
    if (!cfg || typeof cfg !== 'object') return;
    if (typeof cfg.benchmark === 'string') setBenchmark(cfg.benchmark);
    if (Number.isFinite(Number(cfg.initialCapital))) setInitialCapital(Number(cfg.initialCapital));
    if (Number.isFinite(Number(cfg.maxLeverage))) setMaxLeverage(Number(cfg.maxLeverage));
    if (typeof cfg.allowShort === 'boolean') setAllowShort(cfg.allowShort);
    if (typeof cfg.start === 'string') setStart(cfg.start);
    if (typeof cfg.end === 'string') setEnd(cfg.end);
    if (Array.isArray(cfg.universe)) {
      setPresets(new Set());
      setCustom(cfg.universe.join(', '));
    }
  }

  // AI-чат: отправляем всю историю, ответ кладём в чат, извлечённый код применяем в редактор.
  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    const next: ChatMsg[] = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(next);
    setChatInput('');
    setChatBusy(true);
    try {
      const r = await fetch('/api/backtest/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Не удалось получить ответ');
      const reply = typeof d?.reply === 'string' && d.reply.trim() ? d.reply : '(пустой ответ)';
      setChatMessages([...next, { role: 'assistant', content: reply }]);
      if (typeof d?.code === 'string' && d.code.trim()) {
        setStrategy(d.code);
        toast({
          variant: 'success',
          title: 'Код обновлён из чата',
          description: d?.truncated ? 'Ответ обрезан по лимиту — попросите вариант покороче.' : 'Проверьте код перед запуском.',
        });
      } else if (d?.truncated) {
        toast({ variant: 'error', title: 'Ответ обрезан', description: 'Слишком длинный ответ — упростите запрос.' });
      }
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка AI-чата', description: e?.message });
    } finally {
      setChatBusy(false);
    }
  }
  function clearChat() {
    setChatMessages([]);
    setChatInput('');
  }

  // При прогоне без активной стратегии — авто-создаём её (история прогонов копится внутри стратегии).
  async function ensureStrategyForRun(): Promise<number | null> {
    if (activeStrategyIdRef.current != null) return activeStrategyIdRef.current;
    const base = scriptUniverse.length ? scriptUniverse : uiUniverse;
    // Запасной заголовок по тикерам — если AI-нейминг недоступен (нет ключа/лимит).
    const title = base.length ? base.slice(0, 3).join('/') + (base.length > 3 ? ' …' : '') : `Стратегия · ${autoStamp()}`;
    try {
      const r = await fetch('/api/backtest/strategies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, autoName: true, code: strategy, config: buildConfig(), chat: chatMessages.slice(-40) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      const id = Number(d?.id) || null;
      setActiveStrategyId(id);
      setActiveStrategyTitle(d?.title || title);
      loadStrategies();
      return id;
    } catch {
      return null;
    }
  }

  // Автосохранение результата прогона: снимок уходит ВНУТРЬ стратегии; заголовок/описание пишет AI (на сервере).
  async function autosaveRun(resultHtml: string, config: Record<string, unknown> | null, strategyId: number | null) {
    if (!resultHtml) return;
    try {
      await fetch('/api/backtest/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resultHtml, config, strategy, strategyId, autosaved: true }),
      });
      loadRuns();
    } catch {
      /* автосохранение не должно мешать прогону */
    }
  }

  async function execute() {
    if (running) return;
    if (!canRun) {
      toast({ variant: 'error', title: 'Пустая вселенная', description: 'Задайте UNIVERSE = [...] в скрипте или добавьте тикеры в полях слева.' });
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
    reflectPermalink(null, null); // свежий прогон ещё не сохранён — убираем устаревший ?run/?strategy
    setStatus('Отправка запроса…');
    // Локальные накопители — чтобы собрать HTML для автосохранения сразу после прогона.
    const lBlocks: string[] = [];
    let lLog = '';
    let lChart: EquityPayload | null = null;
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
                const parsed = JSON.parse(atob(m[1]));
                lChart = parsed;
                setLiveChart(parsed);
              } catch {
                /* битый снимок — пропускаем */
              }
            } else {
              lBlocks.push(ev.html);
              setBlocks((b) => [...b, ev.html]);
            }
          } else if (ev.type === 'log') {
            lLog += ev.text;
            setLog((l) => l + ev.text);
          } else if (ev.type === 'done') setStatus('Готово');
        }
      }
      // Автосохранение результата (если прогон что-то выдал и не упал с карточкой ошибки).
      const html = composeResultHtml(lChart, lLog, lBlocks);
      const hasError = lBlocks.some((b) => b.includes('rerrblk'));
      if (html && !hasError) {
        const sid = await ensureStrategyForRun(); // прогон всегда попадает внутрь стратегии
        await autosaveRun(html, config, sid);
      }
    } catch (e: any) {
      setStatus('Ошибка');
      toast({ variant: 'error', title: 'Ошибка выполнения', description: e?.message });
    } finally {
      setRunning(false);
    }
  }

  // ── Стратегии: сохранить/обновить/переименовать/открыть/удалить ──
  function openSaveStrategyModal() {
    setStrategyModal({ mode: 'save', title: activeStrategyTitle || `Стратегия · ${autoStamp()}` });
  }
  async function openRenameStrategy(id: number) {
    try {
      const d = await (await fetch(`/api/backtest/strategies/${id}`)).json();
      const s = d?.strategy;
      if (!s) throw new Error('Стратегия не найдена');
      setStrategyModal({ mode: 'rename', id, title: s.title || '' });
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }
  // AI-подсказка названия по идее (код + чат) — заполняет поле в модалке.
  async function suggestName() {
    if (!strategyModal) return;
    if (!strategy.trim()) {
      toast({ variant: 'error', title: 'Нет кода', description: 'Сначала напишите стратегию.' });
      return;
    }
    setSuggestingName(true);
    try {
      const r = await fetch('/api/backtest/strategies/suggest-name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: strategy, chat: chatMessages.slice(-40) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Не удалось предложить название');
      const t = String(d?.title || '').trim();
      if (t) setStrategyModal((m) => (m ? { ...m, title: t } : m));
    } catch (e: any) {
      toast({ variant: 'error', title: 'AI-подсказка недоступна', description: e?.message });
    } finally {
      setSuggestingName(false);
    }
  }
  async function confirmStrategyModal() {
    if (!strategyModal || !strategyModal.title.trim()) return;
    setSavingStrategy(true);
    try {
      if (strategyModal.mode === 'save') {
        const r = await fetch('/api/backtest/strategies', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: strategyModal.title.trim(), code: strategy, config: buildConfig(), chat: chatMessages.slice(-40) }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'Не удалось сохранить стратегию');
        setActiveStrategyId(Number(d?.id) || null);
        setActiveStrategyTitle(d?.title || strategyModal.title.trim());
        toast({ variant: 'success', title: 'Стратегия сохранена', description: d?.title });
      } else {
        const r = await fetch(`/api/backtest/strategies/${strategyModal.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: strategyModal.title.trim() }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || 'Не удалось переименовать');
        if (activeStrategyId === strategyModal.id) setActiveStrategyTitle(strategyModal.title.trim());
        toast({ variant: 'success', title: 'Переименовано' });
      }
      setStrategyModal(null);
      loadStrategies();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Ошибка сохранения', description: e?.message });
    } finally {
      setSavingStrategy(false);
    }
  }
  async function updateActiveStrategy() {
    if (activeStrategyId == null) return;
    try {
      const r = await fetch(`/api/backtest/strategies/${activeStrategyId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: strategy, config: buildConfig(), chat: chatMessages.slice(-40) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Не удалось обновить');
      toast({ variant: 'success', title: 'Стратегия обновлена', description: activeStrategyTitle || undefined });
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось обновить', description: e?.message });
    }
  }
  async function openStrategy(id: number) {
    try {
      const d = await (await fetch(`/api/backtest/strategies/${id}`)).json();
      const s = d?.strategy;
      if (!s) throw new Error('Стратегия не найдена');
      setStrategy(typeof s.code === 'string' ? s.code : '');
      if (s.config) {
        try {
          applyConfig(JSON.parse(s.config));
        } catch {
          /* битый конфиг — игнорируем */
        }
      }
      // Восстанавливаем единый тред AI-чата стратегии (это загрузка, а не правка — не пересохраняем).
      try {
        const arr = s.chat ? JSON.parse(s.chat) : [];
        suppressChatPersist.current = true;
        setChatMessages(Array.isArray(arr) ? arr.filter((m: any) => m && typeof m.content === 'string') : []);
      } catch {
        suppressChatPersist.current = true;
        setChatMessages([]);
      }
      setActiveStrategyId(s.id);
      setActiveStrategyTitle(s.title || null);
      // Сбрасываем область результата (открыли стратегию, а не результат).
      setOpenedRunId(null);
      setIsFresh(false);
      setBlocks([]);
      setLog('');
      setLiveChart(null);
      setViewDesc(null);
      setStatus('');
      reflectPermalink('strategy', s.id); // адресная строка → пермалинк на стратегию
      toast({ variant: 'success', title: 'Стратегия открыта', description: s.title || undefined });
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось открыть', description: e?.message });
    }
  }
  function newStrategy() {
    setStrategy(DEFAULT_STRATEGY);
    setActiveStrategyId(null);
    setActiveStrategyTitle(null);
    setDraftRestored(false);
    setChatMessages([]);
    setChatInput('');
    reflectPermalink(null, null); // новая (несохранённая) стратегия — убираем устаревший пермалинк
    toast({ variant: 'success', title: 'Новая стратегия', description: 'Редактор и чат сброшены.' });
  }
  async function onDeleteStrategy(id: number) {
    try {
      const r = await fetch(`/api/backtest/strategies/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Ошибка');
      if (activeStrategyId === id) {
        setActiveStrategyId(null);
        setActiveStrategyTitle(null);
      }
      toast({ variant: 'success', title: 'Стратегия удалена', description: 'Вместе с её сохранёнными прогонами.' });
      loadStrategies();
      loadRuns();
    } catch (e: any) {
      toast({ variant: 'error', title: 'Не удалось удалить', description: e?.message });
    }
  }

  // ── Результаты прогонов ──
  function openSaveResultModal() {
    setRunModal({ mode: 'save', title: `Бэктест · ${autoStamp()}`, description: '' });
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
            strategyId: activeStrategyId,
            autosaved: false,
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

  // Пермалинки: открытый прогон/стратегия отражаются в адресной строке (без навигации) — ссылку
  // можно скопировать и открыть напрямую. ?run=<id> и ?strategy=<id> взаимоисключающие.
  function reflectPermalink(kind: 'run' | 'strategy' | null, id: number | null) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('run');
      url.searchParams.delete('strategy');
      if (kind && id != null) url.searchParams.set(kind, String(id));
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* нет window/URL — игнор */
    }
  }
  async function copyPermalink(kind: 'run' | 'strategy', id: number) {
    const url = `${window.location.origin}/backtest?${kind}=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ variant: 'success', title: 'Ссылка скопирована', description: url });
    } catch {
      // clipboard недоступен (insecure context) — показываем ссылку, чтобы скопировать вручную.
      toast({ variant: 'info', title: kind === 'run' ? 'Ссылка на прогон' : 'Ссылка на стратегию', description: url });
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
      const sid = run.strategy_id ?? null;
      setActiveStrategyId(sid);
      setActiveStrategyTitle(
        sid != null ? (strategies ?? []).find((s) => s.id === sid)?.title ?? null : null,
      );
      // Чат привязан к стратегии: открытие прогона НЕ заводит свой чат — подтягиваем единый тред
      // стратегии-владельца (для прогонов одной стратегии это всегда один и тот же чат).
      if (sid != null) {
        try {
          const sd = await (await fetch(`/api/backtest/strategies/${sid}`)).json();
          if (sd?.strategy) {
            const arr = sd.strategy.chat ? JSON.parse(sd.strategy.chat) : [];
            suppressChatPersist.current = true;
            setChatMessages(Array.isArray(arr) ? arr.filter((m: any) => m && typeof m.content === 'string') : []);
          }
        } catch {
          /* не удалось подтянуть тред — оставляем текущий */
        }
      }
      setViewDesc(run.description || null);
      setStatus('Сохранённый результат');
      reflectPermalink('run', id); // адресная строка → пермалинк на этот прогон
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

  // Переиспользуемый рендер строки прогона (результата) в списках библиотеки.
  function runRow(r: SavedRunItem, openTestId: string) {
    return (
      <li key={r.id} className="flex items-stretch gap-1">
        <button
          type="button"
          data-testid={openTestId}
          onClick={() => openSavedRun(r.id)}
          className="min-w-0 flex-1 rounded-fk-sm px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
        >
          <span className="block truncate text-[13px] text-ink-2">{r.title || `Прогон #${r.id}`}</span>
          <span className="block text-[11px] text-ink-3">{fmtWhen(r.created_at)}</span>
        </button>
        <button
          type="button"
          aria-label="Скопировать ссылку на прогон"
          title="Скопировать ссылку на прогон"
          data-testid="run-copy-link"
          onClick={() => copyPermalink('run', r.id)}
          className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
        >
          🔗
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
    );
  }

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
        {/* Левая колонка — конфиг + библиотека */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Параметры теста</CardTitle>
              <CardDescription>
                Бенчмарк, капитал и риск-лимиты. Тикеры стратегии задаются в самом скрипте — список{' '}
                <code>UNIVERSE = [...]</code> (любые тикеры EODHD). Издержки выбираются автоматически по рынку
                инструмента (US, Польша .WA, Япония .T и т.д.) и показываются в отчёте.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <Label>Вселенная инструментов (запасная)</Label>
                <FieldHint>
                  Используется, только если в скрипте не задан <code>UNIVERSE</code>. Пресеты/свои тикеры — быстрый старт без кода.
                </FieldHint>
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
                <p className="text-xs text-ink-3">
                  {scriptUniverse.length
                    ? `Из скрипта (UNIVERSE): ${scriptUniverse.length} — ${scriptUniverse.slice(0, 12).join(', ')}${scriptUniverse.length > 12 ? '…' : ''}`
                    : scriptDriven
                      ? 'Вселенная задаётся в скрипте (UNIVERSE)'
                      : `Запасная вселенная из полей: ${uiUniverse.length}`}
                </p>
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
              <CardTitle>Библиотека</CardTitle>
              <CardDescription>
                Стратегии и их история прогонов. Каждый бэктест автоматически сохраняется внутрь своей стратегии, а заголовок прогона AI пишет по изменениям кода.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Стратегии (со вложенными структурированными прогонами) */}
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Стратегии</div>
                {strategies === null ? (
                  <div className="space-y-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : strategies.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    Пока нет сохранённых стратегий. Нажмите «Сохранить как стратегию» под редактором.
                  </p>
                ) : (
                  <ul className="space-y-2" data-testid="saved-strategies">
                    {strategies.map((s) => {
                      const sruns = runsByStrategy.get(s.id) ?? [];
                      const isActive = activeStrategyId === s.id;
                      return (
                        <li key={s.id}>
                          <div className="flex items-stretch gap-1">
                            <button
                              type="button"
                              data-testid="strategy-open"
                              onClick={() => openStrategy(s.id)}
                              className={`min-w-0 flex-1 rounded-fk-sm px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)] ${
                                isActive ? 'bg-brand-50' : ''
                              }`}
                            >
                              <span className="block truncate text-[13px] font-medium text-ink">
                                {s.title || `Стратегия #${s.id}`}
                              </span>
                              <span className="block text-[11px] text-ink-3">
                                {sruns.length ? `${sruns.length} рез.` : 'нет результатов'}
                                {isActive ? ' · активна' : ''}
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label="Скопировать ссылку на стратегию"
                              title="Скопировать ссылку на стратегию"
                              data-testid="strategy-copy-link"
                              onClick={() => copyPermalink('strategy', s.id)}
                              className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                            >
                              🔗
                            </button>
                            <button
                              type="button"
                              aria-label="Переименовать стратегию"
                              onClick={() => openRenameStrategy(s.id)}
                              className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                            >
                              <EditIcon />
                            </button>
                            <button
                              type="button"
                              aria-label="Удалить стратегию"
                              onClick={() => onDeleteStrategy(s.id)}
                              className="shrink-0 rounded-fk-sm px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-down focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                          {sruns.length > 0 && (
                            <ul className="ml-2 mt-1 space-y-1 border-l border-line pl-2" data-testid="strategy-runs">
                              {sruns.map((r) => runRow(r, 'run-open'))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Легаси-прогоны без привязки к стратегии (новые всегда внутри стратегии) */}
              {orphanRuns.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Без стратегии (старые)</div>
                  <ul className="space-y-1.5" data-testid="orphan-runs">
                    {orphanRuns.map((r) => runRow(r, 'run-open'))}
                  </ul>
                </div>
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
                Объявите <code>def on_bar(ctx):</code> (и опц. <code>initialize</code>) и список{' '}
                <code>UNIVERSE = [...]</code>. ctx даёт только прошлое; заявки исполняются по close следующего бара.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Тулбар стратегии: сохранить/обновить/новая + индикатор активной стратегии и черновика */}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={openSaveStrategyModal} data-testid="save-strategy">
                  Сохранить как стратегию
                </Button>
                {activeStrategyId != null && (
                  <>
                    <Button size="sm" variant="ghost" onClick={updateActiveStrategy} data-testid="update-strategy">
                      Обновить
                    </Button>
                    <span className="truncate text-[12px] text-ink-3" title={activeStrategyTitle || undefined}>
                      Активная: <span className="font-medium text-ink-2">{activeStrategyTitle || `#${activeStrategyId}`}</span>
                    </span>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={newStrategy} className="ml-auto" data-testid="new-strategy">
                  Новая
                </Button>
              </div>
              {draftRestored && (
                <p className="text-[11px] text-ink-3">Восстановлен несохранённый черновик кода (автосохранение).</p>
              )}

              {/* AI-чат: диалог о стратегии. Код из ответа применяется в редактор; история сохраняется со стратегией. */}
              <div className="space-y-2 rounded-fk border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-fk-pill bg-brand-50 text-[10px] font-bold text-brand">AI</span>
                  <span className="text-[13px] font-semibold text-ink">AI-чат: опишите и дорабатывайте стратегию</span>
                  {chatMessages.length > 0 && (
                    <button
                      type="button"
                      onClick={clearChat}
                      data-testid="chat-clear"
                      className="ml-auto text-[11px] text-ink-3 transition-colors hover:text-ink"
                    >
                      Очистить чат
                    </button>
                  )}
                </div>

                {chatMessages.length > 0 && (
                  <div
                    ref={chatRef}
                    data-testid="chat-log"
                    className="max-h-[300px] space-y-2 overflow-auto rounded-fk border border-line bg-surface-elev p-2"
                  >
                    {chatMessages.map((m, i) => (
                      <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                        <div
                          className={`max-w-[88%] rounded-fk px-2.5 py-1.5 text-[12.5px] ${
                            m.role === 'user' ? 'bg-brand-50 text-ink' : 'bg-surface-2 text-ink-2'
                          }`}
                        >
                          {m.role === 'assistant' ? (
                            <div className="rdesc" dangerouslySetInnerHTML={{ __html: renderMd(m.content) }} />
                          ) : (
                            <span className="whitespace-pre-wrap">{m.content}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {chatBusy && (
                      <div className="flex justify-start">
                        <div className="inline-flex items-center gap-2 rounded-fk bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink-3">
                          <Spinner className="text-brand" /> думаю…
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <Textarea
                  aria-label="Сообщение AI-чату"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  data-testid="chat-input"
                  placeholder={
                    chatMessages.length
                      ? 'Доработка: «добавь стоп 5%», «торгуй только QQQ», «ребаланс раз в месяц», «объясни, почему так»…'
                      : 'Опишите стратегию словами. Напр.: «Лонг, пока цена выше 200-дневной SMA, иначе в кэш».'
                  }
                  className="min-h-[80px] text-[13px]"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendChat();
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-ink-3">Код из ответа применяется в редактор ниже. ⌘/Ctrl+Enter — отправить.</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={sendChat}
                    loading={chatBusy}
                    disabled={!chatInput.trim()}
                    data-testid="chat-send"
                    className="shrink-0"
                  >
                    {chatBusy ? 'Думаю…' : 'Отправить'}
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

              <Button onClick={execute} loading={running} disabled={!canRun} fullWidth data-testid="run-backtest">
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
                  <Button size="sm" variant="secondary" onClick={openSaveResultModal} data-testid="save-result">
                    Сохранить результат
                  </Button>
                )}
                {!isFresh && openedRunId != null && !running && (
                  <Button size="sm" variant="ghost" onClick={() => copyPermalink('run', openedRunId)} data-testid="run-copy-link-toolbar">
                    🔗 Ссылка
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

      {/* Модалка сохранения/переименования СТРАТЕГИИ */}
      <Modal
        open={!!strategyModal}
        onClose={() => setStrategyModal(null)}
        size="lg"
        title={strategyModal?.mode === 'rename' ? 'Переименовать стратегию' : 'Сохранить стратегию'}
        description="Стратегия — переиспользуемый код + текущий конфиг. Назовите её по идее (или нажмите «Предложить» — AI придумает по коду)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setStrategyModal(null)}>
              Отмена
            </Button>
            <Button onClick={confirmStrategyModal} loading={savingStrategy} disabled={!strategyModal?.title.trim()} data-testid="strategy-save-confirm">
              Сохранить
            </Button>
          </>
        }
      >
        {strategyModal && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={strategyModal.title}
                onChange={(e) => setStrategyModal({ ...strategyModal, title: e.target.value })}
                placeholder="Напр.: Двойной моментум на секторных ETF"
                className="flex-1 text-[15px]"
                data-testid="strategy-title"
              />
              <Button
                variant="secondary"
                onClick={suggestName}
                loading={suggestingName}
                className="shrink-0"
                data-testid="strategy-suggest-name"
              >
                ✨ Предложить
              </Button>
            </div>
            <p className="text-[12px] text-ink-3">
              Название лучше отражать идею/механику стратегии, а не список тикеров — так её проще отличить в библиотеке.
            </p>
          </div>
        )}
      </Modal>

      {/* Модалка сохранения/редактирования РЕЗУЛЬТАТА */}
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
            <Button onClick={confirmRunModal} loading={savingResult} disabled={!runModal?.title.trim()} data-testid="result-save-confirm">
              Сохранить
            </Button>
          </>
        }
      >
        {runModal && (
          <div className="space-y-3 pt-1">
            {runModal.mode === 'save' && (
              <p className="text-[12px] text-ink-3">
                {activeStrategyId != null
                  ? `Будет вложен в стратегию «${activeStrategyTitle || `#${activeStrategyId}`}».`
                  : 'Стратегия не выбрана — результат попадёт в группу «Без стратегии». Сохраните стратегию, чтобы привязать.'}
              </p>
            )}
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
