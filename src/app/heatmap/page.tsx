'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MARKET_EVENTS, EVENT_COLORS, EVENT_LABELS, normalizeCategory,
  eventsByDate, type MarketEvent, type EventCategory,
} from '@/lib/market-events';
import './heatmap.css';
import DatePicker from '@/components/DatePicker';

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

type AiNewsItem = { title: string; category?: string; description?: string };
type AiNews = { date: string; summary: string; items: AiNewsItem[] };

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
const AI_EVENTS_LS_KEY = 'fmp-heatmap-ai-events-v1';
const IMPORTANT_LS_KEY = 'fmp-heatmap-important-v1';
const PARAMS_LS_KEY = 'fmp-heatmap-params-v1';

// ===== Утилиты =====
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function yearsAgoIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
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
  const [fromDate, setFromDate] = useState(yearsAgoIso(2));
  const [toDate, setToDate] = useState(todayIso());
  const [clampPct, setClampPct] = useState(3);
  const [clampPctAnchor, setClampPctAnchor] = useState(10);
  const [customEventsRaw, setCustomEventsRaw] = useState('');
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
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [analysisWindow, setAnalysisWindow] = useState<'1' | '5' | '10' | 'all'>('all');
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
  const [aiNewsError, setAiNewsError] = useState<Record<string, string>>({});

  // ===== AI-исследователь события (Perplexity Sonar) =====
  const [aiInput, setAiInput] = useState('');
  const [aiEvent, setAiEvent] = useState<EventStudy | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStep, setAiStep] = useState('');
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [hoverPhaseDate, setHoverPhaseDate] = useState<string | null>(null);
  const EVENT_PAD_DAYS = 7;

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

  // Если якорь оказался вне нового диапазона — снять
  useEffect(() => {
    if (anchorDate && (anchorDate < fromDate || anchorDate > toDate)) {
      setAnchorDate(null);
    }
  }, [fromDate, toDate, anchorDate]);

  // ===== Load/save localStorage =====
  useEffect(() => {
    try {
      const ai = localStorage.getItem(AI_EVENTS_LS_KEY);
      if (ai) {
        const p = JSON.parse(ai);
        if (Array.isArray(p)) {
          setAiRangeEvents(p.filter((e: any) => e && typeof e.date === 'string' && typeof e.title === 'string')
            .map((e: any) => ({
              date: e.date, title: e.title,
              category: normalizeCategory(e.category),
              description: typeof e.description === 'string' ? e.description : undefined,
            })));
        }
      }
    } catch {}
    try {
      const im = localStorage.getItem(IMPORTANT_LS_KEY);
      if (im) {
        const p = JSON.parse(im);
        if (Array.isArray(p)) setImportantDays(new Set(p));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(AI_EVENTS_LS_KEY, JSON.stringify(aiRangeEvents)); } catch {}
  }, [aiRangeEvents]);
  useEffect(() => {
    try { localStorage.setItem(IMPORTANT_LS_KEY, JSON.stringify(Array.from(importantDays))); } catch {}
  }, [importantDays]);

  // ===== Derived =====
  const tickers = useMemo(
    () => tickersInput.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean),
    [tickersInput]
  );

  const customEvents = useMemo<MarketEvent[]>(() => {
    if (!customEventsRaw.trim()) return [];
    try {
      const parsed = JSON.parse(customEventsRaw);
      if (Array.isArray(parsed)) {
        return parsed.filter((e: any) => e && typeof e.date === 'string' && typeof e.title === 'string')
          .map((e: any) => ({
            date: e.date, title: e.title,
            category: normalizeCategory(e.category),
            description: e.description,
          }));
      }
    } catch {}
    const out: MarketEvent[] = [];
    for (const line of customEventsRaw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const parts = t.split('|').map(s => s.trim());
      if (parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
        out.push({ date: parts[0], title: parts[1], category: normalizeCategory(parts[2]) });
      }
    }
    return out;
  }, [customEventsRaw]);

  const allEvents = useMemo(() => {
    const seen = new Set<string>();
    const out: MarketEvent[] = [];
    for (const src of [MARKET_EVENTS, customEvents, aiRangeEvents]) {
      for (const e of src) {
        const k = `${e.date}|${e.title}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }, [customEvents, aiRangeEvents]);
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

  const mode: 'daily' | 'cumulative' = anchorDate ? 'cumulative' : 'daily';
  const clamp = (mode === 'cumulative') ? clampPctAnchor / 100 : clampPct / 100;

  // Матрица значений: дневная или накопленная от якоря; null для дат до якоря и вне окна.
  const matrix = useMemo(() => {
    const out: Record<string, (number | null)[]> = {};
    const win = analysisWindow === 'all' ? 99999 : parseInt(analysisWindow, 10);
    for (const sym of loadedTickers) {
      const row: (number | null)[] = [];
      const m = prices[sym] || {};
      if (mode === 'cumulative' && anchorDate) {
        const ap = m[anchorDate];
        const anchorIdx = tradingDates.indexOf(anchorDate);
        for (let i = 0; i < tradingDates.length; i++) {
          const d = tradingDates[i];
          if (i < anchorIdx || !ap || !m[d]) { row.push(null); continue; }
          const k = i - anchorIdx;
          if (k > win) { row.push(null); continue; }
          row.push(m[d] / ap - 1);
        }
      } else {
        let prev: number | null = null;
        for (let i = 0; i < tradingDates.length; i++) {
          const p = m[tradingDates[i]] ?? null;
          if (p != null && prev != null) row.push(p / prev - 1);
          else row.push(null);
          if (p != null) prev = p;
        }
      }
      out[sym] = row;
    }
    return out;
  }, [prices, loadedTickers, tradingDates, anchorDate, mode, analysisWindow]);

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

  // Кумулятив от якоря на последнюю дату окна — для KPI
  const tickerCumFromAnchor = useMemo(() => {
    const out: Record<string, number> = {};
    if (!anchorDate) return out;
    const win = analysisWindow === 'all' ? 99999 : parseInt(analysisWindow, 10);
    const anchorIdx = tradingDates.indexOf(anchorDate);
    if (anchorIdx < 0) return out;
    const endIdx = Math.min(tradingDates.length - 1, anchorIdx + win);
    for (const sym of loadedTickers) {
      const m = prices[sym] || {};
      const ap = m[anchorDate];
      let lastVal = 0;
      for (let i = anchorIdx; i <= endIdx; i++) {
        const p = m[tradingDates[i]];
        if (p != null && ap) lastVal = p / ap - 1;
      }
      out[sym] = lastVal;
    }
    return out;
  }, [prices, loadedTickers, tradingDates, anchorDate, analysisWindow]);

  const activeCum = anchorDate ? tickerCumFromAnchor : tickerCum;

  const orderedTickers = useMemo(() => {
    if (!sortByCum) return loadedTickers;
    return [...loadedTickers].sort((a, b) => (activeCum[b] ?? 0) - (activeCum[a] ?? 0));
  }, [loadedTickers, sortByCum, activeCum]);

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

      // Авто-настройка heatmap: тикеры, даты ±N дней.
      const tks = study.summary.affected_tickers.slice(0, 10);
      const from = study.summary.start ? addDays(study.summary.start, -EVENT_PAD_DAYS) : fromDate;
      const todayStr = todayIso();
      let to = study.summary.end ? addDays(study.summary.end, EVENT_PAD_DAYS) : toDate;
      if (to > todayStr) to = todayStr;
      if (tks.length) {
        setTickersInput(tks.join(','));
        setFromDate(from);
        setToDate(to);
        clearInterval(stepTimer);
        setAiStep('Обновляю heatmap…');
        await loadDataset(tks, from, to); // тикеры без данных FMP отфильтруются здесь
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
    setAnchorDate(null);
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

  // При открытии страницы — авто-показ последнего сохранённого набора из кэша
  // (без вызовов FMP). Параметры берём из localStorage прошлой сессии.
  useEffect(() => {
    let tk = DEFAULT_TICKERS, f = yearsAgoIso(2), t = todayIso();
    try {
      const s = localStorage.getItem(PARAMS_LS_KEY);
      if (s) {
        const p = JSON.parse(s);
        if (typeof p.tickers === 'string' && p.tickers.trim()) { tk = p.tickers; setTickersInput(p.tickers); }
        if (typeof p.from === 'string') { f = p.from; setFromDate(p.from); }
        if (typeof p.to === 'string') { t = p.to; setToDate(p.to); }
      }
    } catch {}
    const tks = tk.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!tks.length) return;
    const qs = new URLSearchParams({
      tickers: tks.join(','), from: f, to: t, grades: fetchGrades ? '1' : '0', cacheOnly: '1',
    });
    fetch(`/api/heatmap/dataset?${qs.toString()}`)
      .then(r => r.json())
      .then(res => {
        if (res && !res.error && !res.miss && (res.loadedTickers || []).length) {
          setPrices(res.prices || {});
          setGrades(res.grades || {});
          setLoadedTickers(res.loadedTickers || []);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== AI-новости для дня =====
  async function loadAiNews(date: string, force = false) {
    if (aiNews[date] && !force) return;

    // Если активно AI-событие и на эту дату есть пункты хронологии — берём новости
    // прямо из них (уже на языке браузера, со ссылками). Без вызова Marketaux.
    if (aiEvent) {
      const hits = aiEvent.timeline.filter(t => t.date === date);
      if (hits.length) {
        const items = hits.flatMap(t => {
          const srcs = (t.sources && t.sources.length ? t.sources : ['']);
          return srcs.map(u => ({
            title: t.title,
            category: 'other',
            description: t.description || '',
            source: (() => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : undefined; } catch { return undefined; } })(),
            url: u || undefined,
          }));
        });
        setAiNews(prev => ({
          ...prev,
          [date]: { date, summary: '', items, source: 'AI event', cached: false } as any,
        }));
        return;
      }
    }

    setAiNewsLoading(prev => ({ ...prev, [date]: true }));
    setAiNewsError(prev => ({ ...prev, [date]: '' }));
    try {
      const res = await fetch(
        `/api/ai/news?date=${encodeURIComponent(date)}` +
        `&tickers=${encodeURIComponent(tickersInput)}` +
        (force ? '&force=1' : '')
      ).then(r => r.json());
      if (res?.error) {
        setAiNewsError(prev => ({ ...prev, [date]: res.error }));
        return;
      }
      setAiNews(prev => ({ ...prev, [date]: res }));
    } catch (e: any) {
      setAiNewsError(prev => ({ ...prev, [date]: e.message }));
    } finally {
      setAiNewsLoading(prev => ({ ...prev, [date]: false }));
    }
  }

  function toggleImportant(date: string) {
    setImportantDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function setAnchorAndClose(date: string | null) {
    setAnchorDate(date);
    setSelectedDate(null);
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
    // Новости теперь подгружаются только по клику на кнопку «📰 Загрузить новости дня» —
    // чтобы избежать лишних AI-запросов и галлюцинаций на каждый popup.
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
    const dfa = anchorDate && idx >= 0
      ? Math.max(0, idx - tradingDates.indexOf(anchorDate)) : null;
    tip.innerHTML =
      `<b>${hover.sym}</b> · ${hover.date}${dfa != null ? ` · T+${dfa}` : ''}<br>` +
      `close: ${price != null ? price.toFixed(2) : '—'}` +
      `<br>${mode === 'cumulative' ? 'от якоря' : 'день/день'}: <b>${fmtPct(v ?? null, 2)}</b>` +
      (evs.length ? '<br>' + evs.map(e =>
        `<span style="color:${EVENT_COLORS[e.category]}">●</span> ${e.title}`
      ).join('<br>') : '');
    tip.style.left = (hover.x + 14) + 'px';
    tip.style.top = (hover.y + 14) + 'px';
    tip.style.opacity = '1';
  }, [hover, prices, matrix, tradingDates, anchorDate, mode, eventsMap]);

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
    if (tradingDates.length && scrollRef.current && !anchorDate) {
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
                      onClick={() => setSelectedDate(it.date)}
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

        {/* Setbar */}
        <div className="hm-setbar">
          <span className="hm-pill" onClick={() => setDrawer(true)} title="Изменить тикеры">
            <b>{tickersSummary || '—'}</b>
          </span>
          <span className="hm-pill" onClick={() => setDrawer(true)} title="Изменить диапазон">
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
            <div className="hm-fld">
              <label>Шкала ±% от якоря</label>
              <input type="number" value={clampPctAnchor} min={1} step={1}
                onChange={e => setClampPctAnchor(parseFloat(e.target.value) || 10)} />
            </div>

            <div className="hm-drawer-full hm-fld">
              <label>Свои события (JSON или `YYYY-MM-DD | заголовок | категория` на строку)</label>
              <textarea value={customEventsRaw} onChange={e => setCustomEventsRaw(e.target.value)}
                placeholder='2024-05-10 | CPI выше прогноза | macro' />
            </div>
          </div>
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
                      onClick={() => setSelectedDate(it.date)}
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

        {/* Control row — только в режиме якоря */}
        {tradingDates.length > 0 && anchorDate && (
          <div className="hm-ctl">
            <>
                <div className="hm-winseg">
                  {(['1', '5', '10', 'all'] as const).map(w => (
                    <button key={w}
                      className={analysisWindow === w ? 'on' : ''}
                      onClick={() => setAnalysisWindow(w)}>
                      {w === 'all' ? 'Весь след.' : `+${w}д`}
                    </button>
                  ))}
                </div>
                <span className="hm-mode">
                  Якорь: <b>{anchorDate}</b>
                  {eventsMap[anchorDate] && (
                    <span style={{ color: 'var(--hm-tx2)', marginLeft: 6 }}>
                      — {eventsMap[anchorDate][0].title}
                    </span>
                  )}
                </span>
                <button className="hm-ghost" onClick={() => setAnchorDate(null)}>✕ Снять якорь</button>
            </>
          </div>
        )}

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
                <div className="k">{anchorDate ? 'Сильнее на событие' : 'Лидер периода'}</div>
                <div className="v" style={{ color: kpi.leader.c >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
                  {kpi.leader.t} {fmtPct(kpi.leader.c, 1)}
                </div>
                <div className="vsub">{anchorDate ? `с ${anchorDate}` : 'весь период'}</div>
              </div>
              <div className="hm-kpi">
                <div className="k">{anchorDate ? 'Слабее на событие' : 'Аутсайдер периода'}</div>
                <div className="v" style={{ color: kpi.outsider.c >= 0 ? 'var(--hm-pos)' : 'var(--hm-neg)' }}>
                  {kpi.outsider.t} {fmtPct(kpi.outsider.c, 1)}
                </div>
                <div className="vsub">{anchorDate ? `с ${anchorDate}` : 'весь период'}</div>
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
                    const isAnchor = anchorDate === d;
                    const hot = hotDays.has(d);
                    const sel = selectedDate === d;
                    return (
                      <th key={d}>
                        <div
                          className={`hm-dh ${isAnchor ? 'anchor' : ''} ${imp ? 'imp' : ''} ${hot ? 'hot' : ''} ${sel ? 'sel' : ''} ${aiMarkerDates.has(d) ? 'aimark' : ''} ${hoverPhaseDate === d ? 'aimark-hot' : ''}`}
                          onClick={() => setSelectedDate(sel ? null : d)}
                          title={`${d} (${weekdayShort(d)})${evs ? '\n' + evs.map(e => e.title).join('\n') : ''}`}
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
                {orderedTickers.map(sym => {
                  const row = matrix[sym] || [];
                  const cum = activeCum[sym] ?? 0;
                  const gMap = grades[sym] || {};
                  return (
                    <tr key={sym}>
                      <td className="tk">
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
                        const isAnchor = anchorDate === d;
                        const gItems = gMap[d];
                        const cls = `${imp ? 'impcol ' : ''}${isAnchor ? 'anchorcol ' : ''}${selectedDate === d ? 'selcol ' : ''}${hotDays.has(d) ? 'hotcol ' : ''}${aiMarkerDates.has(d) ? 'aimarkcol ' : ''}${hoverPhaseDate === d ? 'aimarkcol-hot ' : ''}${gItems?.length ? 'hm-cell-grade ' : ''}`;
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
                            onClick={() => setSelectedDate(selectedDate === d ? null : d)}
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
          </div>

          {/* Правая колонка: лента событий ↔ детали выбранного дня */}
          <aside className="hm-feed-panel">
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
                      onClick={() => setSelectedDate(d)}>
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
                <div className="d">{selectedDate} <span style={{ fontSize: 12, color: 'var(--hm-tx3)', fontWeight: 400 }}>· {weekdayShort(selectedDate)}</span></div>
                <div className="wd">
                  {eventsMap[selectedDate]?.length
                    ? eventsMap[selectedDate].map((e, i) => (
                      <span key={i}>
                        <span style={{ color: EVENT_COLORS[e.category] }}>●</span> {e.title}
                        {i < eventsMap[selectedDate].length - 1 ? '; ' : ''}
                      </span>
                    ))
                    : <span style={{ color: 'var(--hm-tx3)' }}>событий нет в курированном списке</span>}
                </div>
              </div>
              <button className="hm-xb" onClick={() => setSelectedDate(null)} title="Назад к ленте">✕</button>
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
              <div className="hm-acts">
                <button
                  className={anchorDate === selectedDate ? 'on-anc' : ''}
                  onClick={() => setAnchorAndClose(anchorDate === selectedDate ? null : selectedDate)}>
                  ⚓ {anchorDate === selectedDate ? 'Снять якорь' : 'Накопленная с этой даты'}
                </button>
                <button
                  onClick={() => loadAiNews(selectedDate, true)}
                  disabled={!!aiNewsLoading[selectedDate]}>
                  {aiNewsLoading[selectedDate]
                    ? 'Загружаю…'
                    : aiNews[selectedDate] ? '🔄 Обновить новости' : '📰 Загрузить новости дня'}
                </button>
                <button
                  className={importantDays.has(selectedDate) ? 'on-imp' : ''}
                  onClick={() => toggleImportant(selectedDate)}>
                  {importantDays.has(selectedDate) ? '★ Снять важное' : '☆ Отметить важным'}
                </button>
              </div>
              <div className="hm-nw-h">
                <span>Новости дня</span>
                <span className="src">
                  {aiNews[selectedDate]
                    ? `источник: ${(aiNews[selectedDate] as any).source || 'AI'}${(aiNews[selectedDate] as any).cached ? ' · из кэша' : ''}`
                    : 'источник: Marketaux + AI'}
                </span>
              </div>
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
              ) : aiNewsError[selectedDate] ? (
                <div className="hm-error" style={{ padding: '8px 0' }}>
                  {aiNewsError[selectedDate]} · <a href="#" onClick={e => { e.preventDefault(); loadAiNews(selectedDate, true); }}
                    style={{ color: 'var(--hm-acc)' }}>повторить</a>
                </div>
              ) : aiNews[selectedDate] ? (
                <>
                  {aiNews[selectedDate].summary && (
                    <div style={{ fontSize: 12.5, color: 'var(--hm-tx2)', marginBottom: 8, lineHeight: 1.5 }}>
                      {aiNews[selectedDate].summary}
                    </div>
                  )}
                  {aiNews[selectedDate].items.length === 0 && (
                    <div className="hm-muted" style={{ fontSize: 12 }}>
                      Значимых событий не найдено
                      {(aiNews[selectedDate] as any).stats?.gdeltCount != null && (
                        <> (GDELT-статей: {(aiNews[selectedDate] as any).stats.gdeltCount}).</>
                      )}
                    </div>
                  )}
                  {aiNews[selectedDate].items.map((it: any, i: number) => {
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
                  })}
                </>
              ) : (
                <div className="hm-muted" style={{ fontSize: 12 }}>
                  Нажмите «📰 Загрузить новости дня» выше — статьи берутся из Marketaux,
                  AI выбирает 3-5 значимых и описывает на русском.
                </div>
              )}

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
            </div>
            </div>
          )}
          </aside>
         </div>
        )}
      </div>

      {/* Tooltip */}
      <div ref={tipRef} className="hm-tip" />
    </div>
  );
}
