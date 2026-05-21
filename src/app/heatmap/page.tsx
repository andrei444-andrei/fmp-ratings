'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  MARKET_EVENTS, EVENT_COLORS, EVENT_LABELS, normalizeCategory,
  eventsByDate, type MarketEvent, type EventCategory,
} from '@/lib/market-events';
import './heatmap.css';
import DatePicker from '@/components/DatePicker';
import DayChat from './DayChat';

// ===== Типы =====
type PricesBySymbol = Record<string, Record<string, number>>;

type GradeItem = {
  symbol: string;
  date: string;
  gradingCompany?: string;
  previousGrade?: string;
  newGrade?: string;
  action?: string;
};
type GradesBySymbol = Record<string, Record<string, GradeItem[]>>;

type AiNewsItem = { title: string; category?: string; description?: string; source?: string; url?: string };
type AiEventNewsItem = { title: string; description?: string; sources?: { url: string; host: string }[] };
type AiNews = {
  date: string;
  eventItems?: AiEventNewsItem[];   // из хронологии AI-события
  items?: AiNewsItem[];             // дополнительные (Marketaux + AI)
  marketauxError?: string;
};

type EventPhase = 'trigger' | 'escalation' | 'peak' | 'resolution';
type TimelineItem = {
  phase: EventPhase; date: string; title: string;
  description?: string; tickers?: string[]; sources?: string[];
};
type EventStudy = {
  summary: {
    title: string; start: string; end: string; scale: number;
    resolution: 'received' | 'none' | 'partial'; description: string;
    affected_tickers: string[];
  };
  timeline: TimelineItem[];
};

const PHASE_META: Record<EventPhase, { label: string; color: string }> = {
  trigger:    { label: 'Триггер',   color: '#9aa0ad' },
  escalation: { label: 'Эскалация', color: '#f5d08a' },
  peak:       { label: 'Пик',       color: '#f4626a' },
  resolution: { label: 'Развязка',  color: '#34d399' },
};
const RESOLUTION_LABEL: Record<string, string> = {
  received: 'развязка получена', none: 'развязка не наступила', partial: 'частичная развязка',
};
const AI_EXAMPLES = [
  'Крах SVB, март 2023',
  'GameStop short squeeze, январь 2021',
  'COVID crash, февраль-март 2020',
  'Корейский margin debt, 2026',
];

// ===== Константы =====
const DEFAULT_TICKERS = 'SPY,QQQ,IWM,GLD,USO,TLT,XLE,XLF,XLK,XLU';
const IMPORTANT_LS_KEY = 'fmp-heatmap-important-v1';
const PARAMS_LS_KEY = 'fmp-heatmap-params-v1';

// Группы тикеров для разбивки строк heatmap на блоки.
const GROUP_DEFS: { key: string; label: string; tickers: string[] }[] = [
  { key: 'sectors', label: 'Сектора США',
    tickers: ['SPY','QQQ','IWM','XLE','XLF','XLK','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'] },
  { key: 'regions', label: 'Регионы мира',
    tickers: ['VTI','VGK','FXI','MCHI','KWEB','EWJ','INDA','EWY','EWZ','EWG','EWU','EWQ'] },
];
const GROUP_LABELS: Record<string, string> = {
  sectors: 'Сектора США', regions: 'Регионы мира',
  extra: 'Дополнительно', other: 'Прочее',
};
const GROUP_ORDER = ['sectors', 'regions', 'extra', 'other'];
// Регион → название (для подписи строки в блоке «Регионы мира»).
const REGION_NAME: Record<string, string> = {
  VTI: 'США', SPY: 'США', VGK: 'Европа', EWG: 'Германия', EWU: 'Британия', EWQ: 'Франция',
  FXI: 'Китай', MCHI: 'Китай', KWEB: 'Китай (tech)', EWJ: 'Япония', INDA: 'Индия',
  EWY: 'Корея', EWZ: 'Бразилия',
};
const PRESET_SECTORS = 'SPY,QQQ,IWM,XLE,XLF,XLK,XLV,XLI,XLY,XLP,XLU,XLB,XLRE,XLC';
const PRESET_REGIONS = 'VTI,VGK,FXI,EWJ,INDA,EWY';

// ===== Утилиты =====
function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function cellColor(r: number | null, clamp: number): string {
  if (r == null || !isFinite(r)) return 'transparent';
  const x = Math.max(-1, Math.min(1, r / clamp));
  const a = Math.min(1, Math.sqrt(Math.abs(x)) / 1.05);
  if (Math.abs(x) < 0.04) return 'rgba(255,255,255,.025)';
  if (x >= 0) return `rgba(52, 211, 153, ${(0.16 + a * 0.64).toFixed(3)})`;
  return `rgba(244, 98, 106, ${(0.16 + a * 0.62).toFixed(3)})`;
}
function textColorOn(r: number | null, clamp: number): string {
  if (r == null) return 'var(--hm-tx3)';
  const x = Math.abs(r / clamp);
  if (x < 0.04) return 'var(--hm-tx3)';
  if (x > 0.8) return '#fff';
  return r > 0 ? '#9ff0d2' : '#fbb9bd';
}
function fmtSigned(v: number | null, digits = 1): string {
  if (v == null || !isFinite(v)) return '';
  const a = Math.abs(v);
  return (v >= 0 ? '+' : '−') + a.toFixed(digits);
}
function fmtPct(v: number | null, digits = 2): string {
  if (v == null || !isFinite(v)) return '—';
  return fmtSigned(v * 100, digits) + '%';
}
function monthShort(m: number): string {
  return ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][m];
}
function weekdayShort(iso: string): string {
  const wd = new Date(iso + 'T00:00:00').getDay();
  return ['вс','пн','вт','ср','чт','пт','сб'][wd];
}
function gradesActionColor(action?: string): string {
  if (!action) return '#737373';
  const a = action.toLowerCase();
  if (a.includes('up')) return '#34d399';
  if (a.includes('down')) return '#f4626a';
  if (a.includes('init')) return '#60a5fa';
  return '#737373';
}

export default function HeatmapPage() {
  // ===== Настройки =====
  const [tickersInput, setTickersInput] = useState(DEFAULT_TICKERS);
  const [fromDate, setFromDate] = useState('2010-01-01');
  const [toDate, setToDate] = useState(todayIso());
  const [clampPct, setClampPct] = useState(3);
  const [fetchGrades] = useState(false);

  // ===== Данные =====
  const [prices, setPrices] = useState<PricesBySymbol>({});
  const [grades, setGrades] = useState<GradesBySymbol>({});
  const [loadedTickers, setLoadedTickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ===== UI-состояние =====
  const [drawer, setDrawer] = useState(false);
  const [sortByCum, setSortByCum] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; sym: string; date: string } | null>(null);
  // Активные категории-фильтры для ленты и подсветки (по умолчанию — все).
  const [catFilter, setCatFilter] = useState<Set<EventCategory>>(
    () => new Set(Object.keys(EVENT_LABELS) as EventCategory[])
  );

  // ===== Важные даты + AI-события (localStorage) =====
  const [importantDays, setImportantDays] = useState<Set<string>>(new Set());
  const [aiRangeEvents, setAiRangeEvents] = useState<MarketEvent[]>([]);

  // ===== AI-новости =====
  const [aiNews, setAiNews] = useState<Record<string, AiNews>>({});
  const [aiNewsLoading, setAiNewsLoading] = useState<Record<string, boolean>>({});

  // ===== AI-исследователь события (Perplexity Sonar) =====
  const [aiInput, setAiInput] = useState('');
  const [aiEvent, setAiEvent] = useState<EventStudy | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStep, setAiStep] = useState('');
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [hoverPhaseDate, setHoverPhaseDate] = useState<string | null>(null);
  // Тикеры, добавленные AI-событием (показываются в блоке «Дополнительно»).
  const [extraTickers, setExtraTickers] = useState<Set<string>>(new Set());
  // Наборы тикеров из БД (сектора/страны). Фолбэк — хардкод-дефолты.
  const [tickerSets, setTickerSets] = useState<{ sectors: string[]; countries: string[]; extra: string[]; regionName: Record<string, string>; label: Record<string, string> }>(
    { sectors: GROUP_DEFS[0].tickers, countries: GROUP_DEFS[1].tickers, extra: [], regionName: REGION_NAME, label: { ...REGION_NAME } }
  );

  // Тёмная тема для всего документа пока страница смонтирована
  useEffect(() => {
    const prevBg = document.body.style.background;
    const prevColor = document.body.style.color;
    const prevHtmlBg = document.documentElement.style.background;
    document.body.style.background = '#0a0b0e';
    document.body.style.color = '#e9eaed';
    document.documentElement.style.background = '#0a0b0e';
    document.body.classList.add('hm-dark-body');
    return () => {
      document.body.style.background = prevBg;
      document.body.style.color = prevColor;
      document.documentElement.style.background = prevHtmlBg;
      document.body.classList.remove('hm-dark-body');
    };
  }, []);

  // ===== Важные даты (localStorage) =====
  useEffect(() => {
    try {
      const im = localStorage.getItem(IMPORTANT_LS_KEY);
      if (im) {
        const p = JSON.parse(im);
        if (Array.isArray(p)) setImportantDays(new Set(p));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(IMPORTANT_LS_KEY, JSON.stringify(Array.from(importantDays))); } catch {}
  }, [importantDays]);

  // ===== Лента событий — из БД (ai_events_db), перевод под язык браузера =====
  useEffect(() => {
    if (!fromDate || !toDate) return;
    const lang = (typeof navigator !== 'undefined' ? navigator.language : 'ru').slice(0, 2).toLowerCase();
    const ac = new AbortController();
    fetch(`/api/ai/events-db/events?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&limit=2000`,
      { signal: ac.signal })
      .then(r => r.json())
      .then(res => {
        const arr = Array.isArray(res?.events) ? res.events : [];
        setAiRangeEvents(arr.map((e: any) => {
          const tr = e.translations?.[lang];
          return {
            date: e.date,
            title: String(tr?.title || e.title || '').slice(0, 200),
            category: normalizeCategory(e.category),
            description: (tr?.description ?? e.description) || undefined,
          };
        }).filter((e: any) => e.date && e.title));
      })
      .catch(() => {});
    return () => ac.abort();
  }, [fromDate, toDate]);

  // ===== Derived =====
  const tickers = useMemo(
    () => tickersInput.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean),
    [tickersInput]
  );

  const allEvents = useMemo(() => {
    const seen = new Set<string>();
    const out: MarketEvent[] = [];
    for (const src of [MARKET_EVENTS, aiRangeEvents]) {
      for (const e of src) {
        const k = `${e.date}|${e.title}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }, [aiRangeEvents]);
  const eventsMap = useMemo(() => eventsByDate(allEvents), [allEvents]);

  const tradingDates = useMemo<string[]>(() => {
    if (!loadedTickers.length) return [];
    const set = new Set<string>();
    for (const sym of loadedTickers) {
      const m = prices[sym];
      if (!m) continue;
      for (const d of Object.keys(m)) if (d >= fromDate && d <= toDate) set.add(d);
    }
    return Array.from(set).sort();
  }, [prices, loadedTickers, fromDate, toDate]);

  const clamp = clampPct / 100;

  // Матрица дневных изменений (день/день); null там, где нет соседних цен.
  const matrix = useMemo(() => {
    const out: Record<string, (number | null)[]> = {};
    for (const sym of loadedTickers) {
      const row: (number | null)[] = [];
      const m = prices[sym] || {};
      let prev: number | null = null;
      for (let i = 0; i < tradingDates.length; i++) {
        const p = m[tradingDates[i]] ?? null;
        if (p != null && prev != null) row.push(p / prev - 1);
        else row.push(null);
        if (p != null) prev = p;
      }
      out[sym] = row;
    }
    return out;
  }, [prices, loadedTickers, tradingDates]);

  // Кумулятивная доходность по тикеру за весь видимый период (без учёта окна)
  const tickerCum = useMemo(() => {
    const out: Record<string, number> = {};
    for (const sym of loadedTickers) {
      const m = prices[sym] || {};
      const first = tradingDates.find(d => m[d] != null);
      const last = [...tradingDates].reverse().find(d => m[d] != null);
      if (first && last && m[first] && m[last]) out[sym] = m[last] / m[first] - 1;
      else out[sym] = 0;
    }
    return out;
  }, [prices, loadedTickers, tradingDates]);

  const activeCum = tickerCum;

  const orderedTickers = useMemo(() => {
    if (!sortByCum) return loadedTickers;
    return [...loadedTickers].sort((a, b) => (activeCum[b] ?? 0) - (activeCum[a] ?? 0));
  }, [loadedTickers, sortByCum, activeCum]);

  // Классификация тикера по группе (наборы из БД).
  function classifyTicker(sym: string): string {
    if (extraTickers.has(sym) || tickerSets.extra.includes(sym)) return 'extra';
    if (tickerSets.sectors.includes(sym)) return 'sectors';
    if (tickerSets.countries.includes(sym)) return 'regions';
    return 'other';
  }
  // Строки, разбитые на блоки-группы (сектора / регионы / дополнительно / прочее).
  const groupedTickers = useMemo(() => {
    const buckets: Record<string, string[]> = {};
    for (const sym of orderedTickers) {
      const k = classifyTicker(sym);
      (buckets[k] = buckets[k] || []).push(sym);
    }
    return GROUP_ORDER
      .filter(k => buckets[k]?.length)
      .map(k => ({ key: k, label: GROUP_LABELS[k], tickers: buckets[k] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedTickers, extraTickers, tickerSets]);
  const multiGroup = groupedTickers.length > 1;

  // KPIs
  const kpi = useMemo(() => {
    const arr = loadedTickers.map(t => ({ t, c: activeCum[t] ?? 0 }))
      .sort((a, b) => b.c - a.c);
    if (!arr.length) return null;
    const leader = arr[0];
    const outsider = arr[arr.length - 1];
    return {
      leader, outsider,
      spread: leader.c - outsider.c,
      important: importantDays.size,
      eventsInRange: allEvents.filter(e =>
        e.date >= fromDate && e.date <= toDate &&
        tradingDates.some(d => d >= e.date)
      ).length,
    };
  }, [loadedTickers, activeCum, importantDays, allEvents, fromDate, toDate, tradingDates]);

  // ===== Среднее дневное движение по дате (для KPI ленты и hot-дней) =====
  const dayMove = useMemo(() => {
    const out: Record<string, { avg: number; leader: { tk: string; v: number }; outsider: { tk: string; v: number } }> = {};
    for (let i = 1; i < tradingDates.length; i++) {
      const d = tradingDates[i];
      const prev = tradingDates[i - 1];
      const vals: { tk: string; v: number }[] = [];
      for (const sym of loadedTickers) {
        const m = prices[sym] || {};
        const p = m[d], pp = m[prev];
        if (p != null && pp != null) vals.push({ tk: sym, v: p / pp - 1 });
      }
      if (!vals.length) continue;
      vals.sort((a, b) => b.v - a.v);
      const avg = vals.reduce((s, x) => s + x.v, 0) / vals.length;
      out[d] = { avg, leader: vals[0], outsider: vals[vals.length - 1] };
    }
    return out;
  }, [tradingDates, loadedTickers, prices]);

  // Порог «горячего» дня: средний |move| по всем дням × 2.2 (но не меньше 0.6%).
  const hotThreshold = useMemo(() => {
    const arr = Object.values(dayMove).map(x => Math.abs(x.avg));
    if (!arr.length) return 0.006;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.max(0.006, mean * 2.2);
  }, [dayMove]);

  const hotDays = useMemo(() => {
    const s = new Set<string>();
    for (const d of tradingDates) {
      const mv = dayMove[d];
      if (mv && Math.abs(mv.avg) >= hotThreshold) s.add(d);
    }
    return s;
  }, [tradingDates, dayMove, hotThreshold]);

  // Лента значимых дней: события + важные + hot. Фильтр по активным категориям.
  const feedDays = useMemo(() => {
    const allCats = catFilter.size === Object.keys(EVENT_LABELS).length;
    const set = new Set<string>();
    for (const d of tradingDates) {
      const evs = (eventsMap[d] || []).filter(e => catFilter.has(e.category));
      const hasEvent = evs.length > 0;
      const hadAnyEvent = (eventsMap[d] || []).length > 0;
      // День попадает в ленту если: есть событие активной категории,
      // либо важный, либо hot (но если у дня есть события и все они отфильтрованы — прячем).
      if (hasEvent) { set.add(d); continue; }
      if (hadAnyEvent && !allCats) continue; // события есть, но не в фильтре
      if (importantDays.has(d) || hotDays.has(d)) set.add(d);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a)); // свежие сверху
  }, [tradingDates, eventsMap, importantDays, hotDays, catFilter]);

  function toggleCat(c: EventCategory) {
    setCatFilter(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  // ===== Загрузка цен и grades (через серверный кэш в Turso) =====
  // Весь датасет тянется одним запросом; результат кэшируется на сервере
  // по ключу (тикеры+даты+grades). Повторный запрос тех же параметров не идёт в FMP.
  // ===== AI-исследователь: запрос события и авто-настройка heatmap =====
  async function runAiEvent(text: string) {
    const description = text.trim();
    if (!description || aiBusy) return;
    setAiBusy(true);
    setAiErr(null);
    setAiEvent(null);
    const steps = ['Определяю событие…', 'Ищу новости…', 'Собираю хронологию…', 'Обновляю heatmap…'];
    let si = 0;
    setAiStep(steps[0]);
    const stepTimer = setInterval(() => {
      si = Math.min(si + 1, steps.length - 2);
      setAiStep(steps[si]);
    }, 2500);
    try {
      const lang = typeof navigator !== 'undefined' ? navigator.language : 'ru';
      const res = await fetch('/api/ai/event-timeline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description, lang }),
      }).then(r => r.json());
      if (res?.error) { setAiErr(res.error); return; }
      const study = res as EventStudy;
      if (!study?.summary || !Array.isArray(study.timeline)) {
        setAiErr('AI вернул пустой результат'); return;
      }
      setAiEvent(study);

      // Только ДОБАВЛЯЕМ тикеры события к текущим. Даты диапазона НЕ трогаем —
      // окно показа статистики остаётся прежним (дефолт/выбранное).
      const eventTks = study.summary.affected_tickers.slice(0, 10);
      const current = tickers;
      const added = eventTks.filter(t => !current.includes(t));
      const union = [...current, ...added];
      if (added.length) setExtraTickers(prev => new Set([...prev, ...added]));
      clearInterval(stepTimer);
      setAiStep('Обновляю heatmap…');
      if (added.length) {
        setTickersInput(union.join(','));
        await loadDataset(union, fromDate, toDate); // тикеры без данных FMP отфильтруются здесь
      }
    } catch (e: any) {
      setAiErr(e.message);
    } finally {
      clearInterval(stepTimer);
      setAiBusy(false);
      setAiStep('');
    }
  }

  function resetAiEvent() {
    setAiEvent(null);
    setAiErr(null);
    setAiInput('');
    setHoverPhaseDate(null);
    setExtraTickers(new Set());
  }

  // Даты хронологии активного AI-события (для маркеров на сетке).
  const aiMarkerDates = useMemo(() => {
    const s = new Set<string>();
    if (aiEvent) for (const t of aiEvent.timeline) if (t.date) s.add(t.date);
    return s;
  }, [aiEvent]);

  // Загрузка датасета с явными параметрами (используется и кнопкой, и AI-режимом).
  async function loadDataset(tickersArr: string[], from: string, to: string): Promise<number> {
    if (!tickersArr.length) return 0;
    setLoading(true);
    setError(null);
    setStatus('Загрузка…');
    try {
      const qs = new URLSearchParams({
        tickers: tickersArr.join(','), from, to, grades: fetchGrades ? '1' : '0',
      });
      const res = await fetch(`/api/heatmap/dataset?${qs.toString()}`).then(r => r.json());
      if (res?.error) { setError(res.error); return 0; }
      setPrices(res.prices || {});
      setGrades(res.grades || {});
      setLoadedTickers(res.loadedTickers || []);
      try {
        localStorage.setItem(PARAMS_LS_KEY, JSON.stringify({
          tickers: tickersArr.join(','), from, to, grades: fetchGrades,
        }));
      } catch {}
      const n = (res.loadedTickers || []).length;
      setStatus(`✓ Загружено ${n}/${tickersArr.length}${res.cached ? ' (из кэша)' : ''}` +
        (res.errors?.length ? ` · ошибок: ${res.errors.length}` : ''));
      return n;
    } catch (e: any) {
      setError(e.message);
      return 0;
    } finally {
      setLoading(false);
    }
  }

  function loadAll() { return loadDataset(tickers, fromDate, toDate); }

  // При открытии: грузим наборы тикеров из БД, затем дефолтные тикеры берём
  // из наборов (если нет сохранённых параметров), и авто-показ из кэша без FMP.
  useEffect(() => {
    (async () => {
      // 1. Наборы тикеров (сектора / страны / доп.) из БД.
      let sectors: string[] = tickerSets.sectors;
      let countries: string[] = tickerSets.countries;
      let extra: string[] = tickerSets.extra;
      try {
        const res = await fetch('/api/ticker-sets').then(r => r.json());
        if (Array.isArray(res?.sets) && res.sets.length) {
          const sec: string[] = [], cnt: string[] = [], ext: string[] = [], rn: Record<string, string> = {}, lbl: Record<string, string> = {};
          for (const s of res.sets) {
            const tks = String(s.tickers).split(',').map((x: string) => x.trim().toUpperCase()).filter(Boolean);
            for (const t of tks) lbl[t] = s.label;
            if (s.kind === 'sector') sec.push(...tks);
            else if (s.kind === 'extra') ext.push(...tks);
            else { cnt.push(...tks); for (const t of tks) rn[t] = s.label; }
          }
          sectors = sec; countries = cnt; extra = ext;
          setTickerSets({ sectors: sec, countries: cnt, extra: ext, regionName: rn, label: lbl });
        }
      } catch {}

      // 2. По умолчанию: тикеры из наборов БД (сектора + страны + доп.),
      //    диапазон — с 2010 года. localStorage НЕ используется (детерминированный дефолт).
      const f = '2010-01-01', t = todayIso();
      const tk = [...sectors, ...countries, ...extra].join(',') || DEFAULT_TICKERS;
      setTickersInput(tk);
      setFromDate(f);
      setToDate(t);

      // 3. Авто-показ из кэша (без вызовов FMP).
      const tks = tk.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (!tks.length) return;
      const qs = new URLSearchParams({
        tickers: tks.join(','), from: f, to: t, grades: fetchGrades ? '1' : '0', cacheOnly: '1',
      });
      try {
        const res = await fetch(`/api/heatmap/dataset?${qs.toString()}`).then(r => r.json());
        if (res && !res.error && !res.miss && (res.loadedTickers || []).length) {
          setPrices(res.prices || {});
          setGrades(res.grades || {});
          setLoadedTickers(res.loadedTickers || []);
        } else {
          // Кэша на этот диапазон нет (например, первый заход после смены дефолта) —
          // грузим напрямую, результат закэшируется в Turso для следующих заходов.
          await loadDataset(tks, f, t);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== AI-новости для дня =====
  async function loadAiNews(date: string, force = false) {
    if (aiNews[date] && !force) return;

    // Блок 1 — готовые новости из хронологии активного AI-события (со ссылками).
    const eventItems = aiEvent
      ? aiEvent.timeline.filter(t => t.date === date).map(t => ({
          title: t.title,
          description: t.description || '',
          sources: (t.sources || []).map(u => ({
            url: u,
            host: (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'источник'; } })(),
          })),
        }))
      : [];

    setAiNewsLoading(prev => ({ ...prev, [date]: true }));

    // Блок 2 — дополнительные новости дня через Perplexity (5-10), на языке браузера.
    // Серверный route кэширует результат в Turso (news_day_cache), поэтому повторный
    // клик по дню берёт новости из БД без вызова Perplexity (не тратит поинты).
    const lang = typeof navigator !== 'undefined' ? navigator.language : 'ru';
    let items: any[] = [];
    let marketauxError: string | undefined;
    try {
      const res = await fetch('/api/ai/day-news', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, lang, force }),
      }).then(r => r.json());
      if (res?.error) marketauxError = res.error;
      else items = Array.isArray(res.items) ? res.items : [];
    } catch (e: any) {
      marketauxError = e.message;
    }

    setAiNews(prev => ({
      ...prev,
      [date]: { date, eventItems, items, marketauxError } as any,
    }));
    setAiNewsLoading(prev => ({ ...prev, [date]: false }));
  }

  function toggleImportant(date: string) {
    setImportantDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }


  // Привязка к ближайшему торговому дню (события часто на выходных/праздниках,
  // где нет цены).
  function snapToTradingDay(date: string): string {
    if (!tradingDates.length || tradingDates.includes(date)) return date;
    const after = tradingDates.find(d => d >= date);
    if (after) return after;
    return tradingDates[tradingDates.length - 1];
  }

  // Выбор дня для деталей: привязка к торговому дню; нерабочие дни без данных не открываем.
  function selectDay(date: string) {
    const d = snapToTradingDay(date);
    if (!tradingDates.includes(d)) return;
    setSelectedDate(prev => (prev === d ? null : d));
  }

  // Текст новостей дня для контекста AI-чата (курированные события + AI-новости).
  function buildDayNewsText(date: string): string {
    const lines: string[] = [];
    for (const e of eventsMap[date] || []) {
      lines.push(`• ${e.title}${e.description ? ` — ${e.description}` : ''}`);
    }
    const n = aiNews[date];
    for (const it of n?.eventItems || []) {
      lines.push(`• ${it.title}${it.description ? ` — ${it.description}` : ''}`);
    }
    for (const it of n?.items || []) {
      lines.push(`• ${it.title}${it.description ? ` — ${it.description}` : ''}${it.source ? ` (${it.source})` : ''}`);
    }
    return lines.join('\n');
  }

  // ===== Popup =====
  const popupAgg = useMemo(() => {
    if (!selectedDate) return null;
    const vals: { tk: string; v: number }[] = [];
    for (const sym of loadedTickers) {
      const m = prices[sym] || {};
      const idx = tradingDates.indexOf(selectedDate);
      if (idx <= 0) continue;
      const p = m[selectedDate], pp = m[tradingDates[idx - 1]];
      if (p && pp) vals.push({ tk: sym, v: p / pp - 1 });
    }
    if (!vals.length) return null;
    vals.sort((a, b) => b.v - a.v);
    const avg = vals.reduce((s, x) => s + x.v, 0) / vals.length;
    return { avg, leader: vals[0], outsider: vals[vals.length - 1] };
  }, [selectedDate, prices, loadedTickers, tradingDates]);

  useEffect(() => {
    if (!selectedDate) return;
    // Новости дня загружаются автоматически при выборе даты.
    if (!aiNews[selectedDate] && !aiNewsLoading[selectedDate]) loadAiNews(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // ===== Tooltip =====
  const tipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    if (!hover) { tip.style.opacity = '0'; return; }
    const m = prices[hover.sym] || {};
    const price = m[hover.date];
    const idx = tradingDates.indexOf(hover.date);
    const v = matrix[hover.sym]?.[idx];
    const evs = eventsMap[hover.date] || [];
    tip.innerHTML =
      `<b>${hover.sym}</b> · ${hover.date}<br>` +
      `close: ${price != null ? price.toFixed(2) : '—'}` +
      `<br>день/день: <b>${fmtPct(v ?? null, 2)}</b>` +
      (evs.length ? '<br>' + evs.map(e =>
        `<span style="color:${EVENT_COLORS[e.category]}">●</span> ${e.title}`
      ).join('<br>') : '');
    tip.style.left = (hover.x + 14) + 'px';
    tip.style.top = (hover.y + 14) + 'px';
    tip.style.opacity = '1';
  }, [hover, prices, matrix, tradingDates, eventsMap]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedDate(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Скролл к концу при первой загрузке
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tradingDates.length && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingDates.length]);

  // ===== Рендер =====
  const tickersSummary = tickers.length <= 3
    ? tickers.join(', ')
    : `${tickers.slice(0, 3).join(', ')} +${tickers.length - 3}`;

  return (
    <div className="hm-root">
      <div className="hm-inner">
        {/* Setbar */}
        <div className="hm-setbar">
          <span className="hm-pill" onClick={() => setDrawer(d => !d)} title="Настройки">
            <b>{tickersSummary || '—'}</b>
          </span>
          <span className="hm-pill" onClick={() => setDrawer(d => !d)} title="Настройки">
            <b>{fromDate}</b> → <b>{toDate}</b>
          </span>
          {loadedTickers.length ? (
            <span className="hm-muted" style={{ fontSize: 11 }}>
              {loadedTickers.length}/{tickers.length} · {tradingDates.length} дн.
            </span>
          ) : (
            <span className="hm-muted" style={{ fontSize: 11 }}>нет данных</span>
          )}
          <div className="hm-spacer" />
          <button className="hm-ghost" onClick={() => setDrawer(d => !d)}>⚙</button>
          <button className="hm-ghost" onClick={() => setSortByCum(s => !s)}
            disabled={!loadedTickers.length}
            title={sortByCum ? 'Снять сортировку' : 'Сортировать по доходности'}>
            ⇅ {sortByCum ? 'по %' : ''}
          </button>
          <button className="hm-ghost primary" onClick={loadAll} disabled={loading || !tickers.length}>
            {loading ? '…' : '↻ Загрузить'}
          </button>
        </div>
        {(status || error) && (
          <div className="hm-setbar" style={{ padding: '6px 14px' }}>
            {status && <span className="hm-status">{status}</span>}
            {error && <span className="hm-error">{error}</span>}
          </div>
        )}

        {/* Drawer */}
        <div className={`hm-drawer ${drawer ? 'open' : ''}`}>
          <div className="hm-drawer-in">
            <div className="hm-fld">
              <label>Тикеры</label>
              <input value={tickersInput} onChange={e => setTickersInput(e.target.value)} />
              <div className="hm-preset-row">
                <button type="button" className="hm-ghost"
                  onClick={() => setTickersInput((tickerSets.sectors.join(',')) || PRESET_SECTORS)}>
                  Сектора США
                </button>
                <button type="button" className="hm-ghost"
                  onClick={() => setTickersInput((tickerSets.countries.join(',')) || PRESET_REGIONS)}>
                  Регионы мира
                </button>
              </div>
            </div>
            <div className="hm-fld">
              <label>От</label>
              <DatePicker value={fromDate} onChange={setFromDate} max={toDate} />
            </div>
            <div className="hm-fld">
              <label>До</label>
              <DatePicker value={toDate} onChange={setToDate} min={fromDate} max={todayIso()} />
            </div>
            <div className="hm-fld">
              <label>Шкала ±% дневная</label>
              <input type="number" value={clampPct} min={0.5} step={0.5}
                onChange={e => setClampPct(parseFloat(e.target.value) || 3)} />
            </div>
          </div>
        </div>

        {/* Stage: heatmap + лента новостей */}
        {!tradingDates.length ? (
          <div className="hm-kpi" style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--hm-tx3)' }}>
            Нажмите «↻ Загрузить» — получим дневные цены закрытия для выбранных тикеров и интервала.
          </div>
        ) : (
         <div className="hm-stage">
          <div className="hm-panel">
          {kpi && (
            <div className="hm-kpis">
              <div className="hm-kpi">
                <div className="k">Лидер периода</div>
                <div className="v" style={{ color: kpi.leader.c >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
                  {kpi.leader.t} {fmtPct(kpi.leader.c, 1)}
                </div>
                <div className="vsub">весь период</div>
              </div>
              <div className="hm-kpi">
                <div className="k">Аутсайдер периода</div>
                <div className="v" style={{ color: kpi.outsider.c >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
                  {kpi.outsider.t} {fmtPct(kpi.outsider.c, 1)}
                </div>
                <div className="vsub">весь период</div>
              </div>
              <div className="hm-kpi">
                <div className="k">Разброс реакции</div>
                <div className="v">{(kpi.spread * 100).toFixed(1)} пп</div>
                <div className="vsub">лучший − худший</div>
              </div>
            </div>
          )}
          <div className="hm-gridwrap" ref={scrollRef}>
            <table className="hm-table">
              <thead>
                <tr>
                  <th className="tk">Тикер</th>
                  {tradingDates.map(d => {
                    const evs = eventsMap[d];
                    const imp = importantDays.has(d);
                    const hot = hotDays.has(d);
                    const sel = selectedDate === d;
                    return (
                      <th key={d}>
                        <div
                          className={`hm-dh ${imp ? 'imp' : ''} ${hot ? 'hot' : ''} ${sel ? 'sel' : ''} ${aiMarkerDates.has(d) ? 'aimark' : ''} ${hoverPhaseDate === d ? 'aimark-hot' : ''}`}
                          onClick={() => selectDay(d)}
                          title={`${d} (${weekdayShort(d)})\nКлик — новости дня${evs ? '\n' + evs.map(e => e.title).join('\n') : ''}`}
                        >
                          <div className="hm-lane">
                            {imp && <span className="st">★</span>}
                            {evs && evs.slice(0, 3).map((e, i) => (
                              <span key={i} className="ev" style={{ background: EVENT_COLORS[e.category] }} />
                            ))}
                          </div>
                          <div className="dt">
                            {d.slice(8, 10)}
                            <span style={{ color: 'inherit', opacity: .55, marginLeft: 2 }}>
                              {monthShort(parseInt(d.slice(5, 7), 10) - 1).slice(0, 3).toLowerCase()}
                            </span>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedTickers.map(group => (
                  <Fragment key={group.key}>
                    {multiGroup && (
                      <tr className="hm-grp">
                        <td className="tk hm-grp-tk">{group.label}</td>
                        <td className="hm-grp-fill" colSpan={tradingDates.length} />
                      </tr>
                    )}
                    {group.tickers.map(sym => {
                  const row = matrix[sym] || [];
                  const cum = activeCum[sym] ?? 0;
                  const gMap = grades[sym] || {};
                  const tkLabel = tickerSets.label[sym];
                  return (
                    <tr key={sym}>
                      <td className="tk" title={tkLabel ? `${sym} — ${tkLabel}` : sym}>
                        <div className="hm-tkrow">
                          <span className="hm-tk-sym">{sym}</span>
                          <span className="hm-tkcum"
                            style={{ color: cum >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
                            {fmtPct(cum, 1)}
                          </span>
                        </div>
                      </td>
                      {tradingDates.map((d, i) => {
                        const v = row[i];
                        const imp = importantDays.has(d);
                        const gItems = gMap[d];
                        const cls = `${imp ? 'impcol ' : ''}${selectedDate === d ? 'selcol ' : ''}${hotDays.has(d) ? 'hotcol ' : ''}${aiMarkerDates.has(d) ? 'aimarkcol ' : ''}${hoverPhaseDate === d ? 'aimarkcol-hot ' : ''}${gItems?.length ? 'hm-cell-grade ' : ''}`;
                        return (
                          <td
                            key={d}
                            className={cls}
                            style={{
                              background: cellColor(v, clamp),
                              color: textColorOn(v, clamp),
                              ['--grade-c' as any]: gItems?.length ? gradesActionColor(gItems[0].action) : 'transparent',
                              minWidth: 36,
                              width: 36,
                            }}
                            onClick={() => selectDay(d)}
                            onMouseEnter={e => setHover({ x: e.clientX, y: e.clientY, sym, date: d })}
                            onMouseMove={e => setHover(h => h ? { ...h, x: e.clientX, y: e.clientY } : null)}
                            onMouseLeave={() => setHover(null)}
                          >
                            {v != null ? fmtSigned(v * 100, 1) : '·'}
                            {gItems?.length ? (
                              <span style={{
                                position: 'absolute', bottom: 0, right: 0, width: 5, height: 5,
                                background: gradesActionColor(gItems[0].action),
                                clipPath: 'polygon(100% 0,100% 100%,0 100%)',
                              }} />
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hm-legend">
            <span className="sc">
              <i style={{ background: 'rgba(244,98,106,.7)' }} />
              <i style={{ background: 'rgba(244,98,106,.35)' }} />
              <i style={{ background: 'rgba(255,255,255,.05)' }} />
              <i style={{ background: 'rgba(52,211,153,.35)' }} />
              <i style={{ background: 'rgba(52,211,153,.7)' }} />
              &nbsp; −{Math.round(clamp * 100)}% → +{Math.round(clamp * 100)}%
            </span>
            {(Object.keys(EVENT_LABELS) as EventCategory[]).map(k => (
              <span key={k} className="hm-ev-leg">
                <span className="dot" style={{ background: EVENT_COLORS[k] }} />
                {EVENT_LABELS[k]}
              </span>
            ))}
            <span className="hm-ev-leg">
              <span style={{ color: 'var(--hm-imp)' }}>★</span> отмечено важным
            </span>
          </div>
        {/* AI-исследователь события */}
        <div className="hm-ai">
          {!aiEvent && !aiBusy && (
            <div className="hm-ai-bar">
              <span className="hm-ai-spark">✦</span>
              <input
                className="hm-ai-input"
                placeholder="Опиши событие, которое хочешь изучить"
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runAiEvent(aiInput); }}
              />
              <button className="hm-ghost primary" onClick={() => runAiEvent(aiInput)}
                disabled={!aiInput.trim()}>Изучить</button>
              <div className="hm-ai-chips">
                {AI_EXAMPLES.map(ex => (
                  <span key={ex} className="hm-ai-chip" onClick={() => { setAiInput(ex); runAiEvent(ex); }}>
                    {ex}
                  </span>
                ))}
              </div>
            </div>
          )}

          {aiBusy && (
            <div className="hm-ai-bar">
              <span className="hm-ai-spark spin">✦</span>
              <span className="hm-ai-step">{aiStep || 'Определяю событие…'}</span>
            </div>
          )}

          {aiErr && !aiBusy && (
            <div className="hm-ai-bar">
              <span className="hm-error">AI: {aiErr}</span>
              <button className="hm-ghost" onClick={resetAiEvent}>Закрыть</button>
            </div>
          )}

          {aiEvent && !aiBusy && (
            <div className="hm-ai-result">
              {/* Summary */}
              <div className="hm-ai-sum">
                <div className="hm-ai-sum-h">
                  <div className="t">{aiEvent.summary.title}</div>
                  <button className="hm-ghost" onClick={resetAiEvent}>✕ Сбросить</button>
                </div>
                <div className="hm-ai-sum-meta">
                  {aiEvent.summary.start && (
                    <span className="hm-ai-badge">
                      {aiEvent.summary.start} → {aiEvent.summary.end || '?'}
                      {aiEvent.summary.start && aiEvent.summary.end && (
                        <> · {Math.max(0, Math.round((+new Date(aiEvent.summary.end) - +new Date(aiEvent.summary.start)) / 86400000))} дн.</>
                      )}
                    </span>
                  )}
                  <span className="hm-ai-badge">масштаб {aiEvent.summary.scale}/5</span>
                  <span className="hm-ai-badge">{RESOLUTION_LABEL[aiEvent.summary.resolution]}</span>
                </div>
                {aiEvent.summary.description && (
                  <div className="hm-ai-sum-desc">{aiEvent.summary.description}</div>
                )}
                {aiEvent.summary.affected_tickers.length > 0 && (
                  <div className="hm-ai-tk">
                    {aiEvent.summary.affected_tickers.map(t => (
                      <span key={t} className="hm-ai-tkchip">{t}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Хронология */}
              <div className="hm-ai-timeline">
                {aiEvent.timeline.map((it, i) => {
                  const meta = PHASE_META[it.phase];
                  const active = hoverPhaseDate === it.date || selectedDate === it.date;
                  return (
                    <div
                      key={i}
                      className={`hm-ai-card ${active ? 'active' : ''}`}
                      style={{ borderLeftColor: meta.color }}
                      onMouseEnter={() => setHoverPhaseDate(it.date)}
                      onMouseLeave={() => setHoverPhaseDate(null)}
                      onClick={() => selectDay(it.date)}
                    >
                      <div className="hm-ai-card-h">
                        <span className="ph" style={{ color: meta.color }}>{meta.label}</span>
                        <span className="dt">{it.date}</span>
                      </div>
                      <div className="hm-ai-card-t">{it.title}</div>
                      {it.description && <div className="hm-ai-card-d">{it.description}</div>}
                      {it.tickers && it.tickers.length > 0 && (
                        <div className="hm-ai-tk">
                          {it.tickers.map(t => <span key={t} className="hm-ai-tkchip sm">{t}</span>)}
                        </div>
                      )}
                      {it.sources && it.sources.length > 0 && (
                        <div className="hm-ai-src">
                          {it.sources.map((u, j) => (
                            <a key={j} href={u} target="_blank" rel="noopener noreferrer"
                               onClick={e => e.stopPropagation()}>
                              {(() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'источник'; } })()}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
          </div>

          {/* Правая колонка: лента событий ↔ детали выбранного дня */}
          <aside className="hm-feed-panel">
          <div className="hm-feed-inner">
          {!selectedDate ? (
            <>
              <div className="hm-feed-h">
                <span className="t">Лента событий</span>
                <span className="c">{feedDays.length} дн.</span>
              </div>
              <div className="hm-filters">
                {(Object.keys(EVENT_LABELS) as EventCategory[]).map(k => (
                  <span key={k}
                    className={`hm-fchip ${catFilter.has(k) ? 'on' : 'off'}`}
                    onClick={() => toggleCat(k)}>
                    <span className="dot" style={{ background: EVENT_COLORS[k] }} />
                    {EVENT_LABELS[k]}
                  </span>
                ))}
              </div>
              <div className="hm-feed">
                {feedDays.length === 0 ? (
                  <div className="hm-feed-empty">
                    Значимых дней не найдено. Нажмите «🔥 Найти важные события» в настройках (⚙),
                    отметьте дни важными или поменяйте фильтр категорий.
                  </div>
                ) : feedDays.map(d => {
                  const evs = (eventsMap[d] || []).filter(e => catFilter.has(e.category));
                  const mv = dayMove[d];
                  const hot = hotDays.has(d);
                  const imp = importantDays.has(d);
                  return (
                    <div key={d}
                      className={`hm-fday ${hot ? 'hot' : ''}`}
                      onClick={() => selectDay(d)}>
                      <div className="hm-fday-h">
                        <span className="hm-fday-d">
                          {imp && <span style={{ color: 'var(--hm-imp)' }}>★</span>}
                          {d} <span style={{ color: 'var(--hm-tx3)' }}>· {weekdayShort(d)}</span>
                        </span>
                        {mv && (
                          <span className="hm-fday-mv"
                            style={{ color: mv.avg >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
                            {fmtPct(mv.avg, 1)}
                          </span>
                        )}
                      </div>
                      {evs.length ? evs.slice(0, 3).map((e, i) => (
                        <div key={i} className="hm-fday-ev">
                          <span className="dot" style={{ background: EVENT_COLORS[e.category] }} />
                          <span>{e.title}</span>
                        </div>
                      )) : (
                        <div className="hm-fday-ev hm-muted">
                          <span className="dot" style={{ background: 'var(--hm-tx3)' }} />
                          <span>Сильное движение без новостей в списке</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="hm-pop-detail">
            <div className="hm-pop-h">
              <div>
                <div className="d">
                  <span>{selectedDate}</span>
                  <span style={{ fontSize: 12, color: 'var(--hm-tx3)', fontWeight: 400 }}> · {weekdayShort(selectedDate)}</span>
                </div>
                {eventsMap[selectedDate]?.length ? (
                  <div className="hm-pop-evs">
                    {eventsMap[selectedDate].map((e, i) => (
                      <div key={i} className="hm-pop-ev">
                        <span className="dot" style={{ background: EVENT_COLORS[e.category] }} />
                        <span className="t">{e.title}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="wd" style={{ color: 'var(--hm-tx3)' }}>событий нет в курированном списке</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  className={`hm-xb ${importantDays.has(selectedDate) ? 'on-imp' : ''}`}
                  title={importantDays.has(selectedDate) ? 'Снять важное' : 'Отметить важным'}
                  onClick={() => toggleImportant(selectedDate)}
                >{importantDays.has(selectedDate) ? '★' : '☆'}</button>
                <button className="hm-xb" onClick={() => setSelectedDate(null)} title="Назад к ленте">✕</button>
              </div>
            </div>
            <div className="hm-pop-body">
              {popupAgg && (
                <div className="hm-snap">
                  <div>
                    <div className="l">Средн.</div>
                    <div className="n" style={{ color: popupAgg.avg >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
                      {fmtPct(popupAgg.avg, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="l">Лидер</div>
                    <div className="n" style={{ color: 'var(--hm-pos)' }}>
                      {popupAgg.leader.tk} {fmtPct(popupAgg.leader.v, 1)}
                    </div>
                  </div>
                  <div>
                    <div className="l">Аутсайдер</div>
                    <div className="n" style={{ color: 'var(--hm-neg)' }}>
                      {popupAgg.outsider.tk} {fmtPct(popupAgg.outsider.v, 1)}
                    </div>
                  </div>
                </div>
              )}
              <div className="hm-nw-h">
                <span>Новости дня</span>
                <span className="src">
                  хронология + Perplexity
                  {!aiNewsLoading[selectedDate] && (
                    <> · <a href="#" onClick={e => { e.preventDefault(); loadAiNews(selectedDate, true); }}
                      style={{ color: 'var(--hm-acc)' }}>обновить</a></>
                  )}
                </span>
              </div>

              {/* Блок 1 — из хронологии события */}
              {!!aiNews[selectedDate]?.eventItems?.length && (
                <div className="hm-nw-block">
                  <div className="hm-nw-blabel">Из хронологии события</div>
                  {aiNews[selectedDate].eventItems.map((it: any, i: number) => (
                    <div key={`e${i}`} className="hm-news-item">
                      <div className="ic" style={{ background: 'var(--hm-acc-bg)', color: 'var(--hm-acc)' }}>✦</div>
                      <div style={{ flex: 1 }}>
                        <div className="ti">{it.title}</div>
                        {it.description && (
                          <div className="me" style={{ color: 'var(--hm-tx2)', lineHeight: 1.4 }}>{it.description}</div>
                        )}
                        {it.sources?.length > 0 && (
                          <div className="hm-ai-src">
                            {it.sources.map((s: any, j: number) => (
                              <a key={j} href={s.url} target="_blank" rel="noopener noreferrer">{s.host}</a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Блок 2 — дополнительные новости (Marketaux + AI) */}
              <div className="hm-nw-block">
                <div className="hm-nw-blabel">Дополнительно — Perplexity</div>
                {aiNewsLoading[selectedDate] ? (
                  <>
                    {[0, 1, 2].map(i => (
                      <div key={i} className="hm-news-item">
                        <div className="hm-skel" style={{ width: 28, height: 28, borderRadius: 8, flex: '0 0 28px' }} />
                        <div style={{ flex: 1 }}>
                          <div className="hm-skel" style={{ width: '85%' }} />
                          <div className="hm-skel" style={{ width: '55%', marginTop: 7 }} />
                        </div>
                      </div>
                    ))}
                  </>
                ) : aiNews[selectedDate]?.marketauxError ? (
                  <div className="hm-error" style={{ padding: '8px 0' }}>
                    {aiNews[selectedDate].marketauxError} · <a href="#"
                      onClick={e => { e.preventDefault(); loadAiNews(selectedDate, true); }}
                      style={{ color: 'var(--hm-acc)' }}>повторить</a>
                  </div>
                ) : aiNews[selectedDate]?.items?.length ? (
                  aiNews[selectedDate].items.map((it: any, i: number) => {
                    const cat = normalizeCategory(it.category);
                    const c = EVENT_COLORS[cat];
                    return (
                      <div key={i} className="hm-news-item">
                        <div className="ic" style={{ background: c + '22', color: c }}>
                          {(EVENT_LABELS[cat] || '?').slice(0, 1)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="ti">
                            {it.url ? (
                              <a href={it.url} target="_blank" rel="noopener noreferrer"
                                 style={{ color: 'inherit', textDecoration: 'none' }}
                                 onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                                 onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
                                {it.title}
                              </a>
                            ) : it.title}
                          </div>
                          {it.description && (
                            <div className="me" style={{ color: 'var(--hm-tx2)', lineHeight: 1.4 }}>
                              {it.description}
                            </div>
                          )}
                          <div className="me" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="hm-badge" style={{ background: c + '22', color: c }}>
                              {EVENT_LABELS[cat]}
                            </span>
                            {it.source && (
                              <span style={{ color: 'var(--hm-tx3)', fontSize: 11 }}>· {it.source}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="hm-muted" style={{ fontSize: 12 }}>Дополнительных новостей не найдено.</div>
                )}
              </div>

              {/* Рейтинги аналитиков на эту дату — поверх любых тикеров */}
              {(() => {
                const allG: { tk: string; g: GradeItem }[] = [];
                for (const t of loadedTickers) {
                  for (const g of (grades[t]?.[selectedDate] || [])) allG.push({ tk: t, g });
                }
                if (!allG.length) return null;
                return (
                  <div className="hm-grades">
                    <div className="h">Изменения рейтингов аналитиков</div>
                    {allG.map((x, i) => (
                      <div key={i} className="row">
                        <span style={{ color: 'var(--hm-tx)', fontWeight: 600 }}>{x.tk}</span>
                        {' · '}
                        <span style={{ color: gradesActionColor(x.g.action) }}>●</span>
                        {' '}{x.g.gradingCompany || '?'}: {x.g.previousGrade || '—'} → {x.g.newGrade || '—'}
                        {x.g.action && <span style={{ color: 'var(--hm-tx3)' }}> ({x.g.action})</span>}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* AI-чат по контексту выбранного дня */}
              <DayChat key={selectedDate} date={selectedDate} news={buildDayNewsText(selectedDate)} />
            </div>
            </div>
          )}
          </div>
          </aside>
         </div>
        )}
      </div>

      {/* Tooltip */}
      <div ref={tipRef} className="hm-tip" />
    </div>
  );
}
