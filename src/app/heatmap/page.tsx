'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MARKET_EVENTS, EVENT_COLORS, EVENT_LABELS, normalizeCategory,
  eventsByDate, type MarketEvent, type EventCategory,
} from '@/lib/market-events';
import './heatmap.css';

// ===== Типы =====
type PriceRow = { date: string; price: number };
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

// ===== Константы =====
const DEFAULT_TICKERS = 'SPY,QQQ,IWM,GLD,USO,TLT,XLE,XLF,XLK,XLU';
const AI_EVENTS_LS_KEY = 'fmp-heatmap-ai-events-v1';
const IMPORTANT_LS_KEY = 'fmp-heatmap-important-v1';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ===== Утилиты =====
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function yearsAgoIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = parseInt(from.slice(0, 4), 10);
  let m = parseInt(from.slice(5, 7), 10);
  const yTo = parseInt(to.slice(0, 4), 10);
  const mTo = parseInt(to.slice(5, 7), 10);
  while (y < yTo || (y === yTo && m <= mTo)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
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
  const [fetchGrades, setFetchGrades] = useState(true);

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
  const [popupDate, setPopupDate] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; sym: string; date: string } | null>(null);

  // ===== Важные даты + AI-события (localStorage) =====
  const [importantDays, setImportantDays] = useState<Set<string>>(new Set());
  const [aiRangeEvents, setAiRangeEvents] = useState<MarketEvent[]>([]);
  const [aiRangeLoading, setAiRangeLoading] = useState(false);
  const [aiRangeStatus, setAiRangeStatus] = useState('');

  // ===== AI-новости =====
  const [aiNews, setAiNews] = useState<Record<string, AiNews>>({});
  const [aiNewsLoading, setAiNewsLoading] = useState<Record<string, boolean>>({});
  const [aiNewsError, setAiNewsError] = useState<Record<string, string>>({});

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

  // ===== Загрузка цен и grades =====
  async function loadAll() {
    setLoading(true);
    setError(null);
    setStatus('');
    setAnchorDate(null);
    const nextPrices: PricesBySymbol = {};
    const nextGrades: GradesBySymbol = {};
    const loaded: string[] = [];
    try {
      for (let i = 0; i < tickers.length; i++) {
        const sym = tickers[i];
        setStatus(`${i + 1}/${tickers.length} ${sym} — цены…`);
        try {
          const res = await fetch(
            `/api/fmp/historical-price-eod?symbol=${encodeURIComponent(sym)}` +
            `&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`
          ).then(r => r.json());
          if (res?.error) {
            setError(prev => (prev ? prev + '; ' : '') + `${sym}: ${res.error}`);
            continue;
          }
          const arr: PriceRow[] = Array.isArray(res) ? res : (res?.historical || []);
          if (!arr.length) continue;
          const map: Record<string, number> = {};
          for (const r of arr) {
            if (r && typeof r.date === 'string' && typeof r.price === 'number') map[r.date] = r.price;
          }
          nextPrices[sym] = map;
        } catch (e: any) {
          setError(prev => (prev ? prev + '; ' : '') + `${sym}: ${e.message}`);
          continue;
        }
        if (fetchGrades) {
          setStatus(`${i + 1}/${tickers.length} ${sym} — рейтинги…`);
          try {
            const gRes = await fetch(`/api/fmp/grades?symbol=${encodeURIComponent(sym)}`).then(r => r.json());
            if (Array.isArray(gRes)) {
              const byDate: Record<string, GradeItem[]> = {};
              for (const g of gRes as GradeItem[]) {
                if (!g || !g.date) continue;
                if (g.date < fromDate || g.date > toDate) continue;
                (byDate[g.date] = byDate[g.date] || []).push(g);
              }
              nextGrades[sym] = byDate;
            }
          } catch {}
        }
        loaded.push(sym);
        await sleep(40);
      }
      setPrices(nextPrices);
      setGrades(nextGrades);
      setLoadedTickers(loaded);
      setStatus(`✓ Загружено ${loaded.length}/${tickers.length}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ===== AI-новости для дня =====
  async function loadAiNews(date: string, force = false) {
    if (aiNews[date] && !force) return;
    setAiNewsLoading(prev => ({ ...prev, [date]: true }));
    setAiNewsError(prev => ({ ...prev, [date]: '' }));
    try {
      const res = await fetch(
        `/api/ai/news?date=${encodeURIComponent(date)}` +
        `&tickers=${encodeURIComponent(tickersInput)}`
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

  // ===== AI помесячный батч =====
  async function aiFillEvents() {
    setAiRangeLoading(true);
    setAiRangeStatus('');
    try {
      const months = monthsBetween(fromDate, toDate);
      const collected: MarketEvent[] = [];
      let newCount = 0;
      const existingKeys = new Set(
        [...MARKET_EVENTS, ...customEvents, ...aiRangeEvents].map(e => `${e.date}|${e.title}`)
      );
      for (let i = 0; i < months.length; i++) {
        const mo = months[i];
        setAiRangeStatus(`${i + 1}/${months.length} (${mo})…  новых: ${newCount}`);
        try {
          const res = await fetch(
            `/api/ai/events-month?month=${mo}&tickers=${encodeURIComponent(tickersInput)}`
          ).then(r => r.json());
          if (res?.error) { setAiRangeStatus(`${mo}: ${res.error}`); continue; }
          const arr = Array.isArray(res?.events) ? res.events : [];
          for (const e of arr) {
            const d = String(e.date || '');
            const ti = String(e.title || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !ti) continue;
            const k = `${d}|${ti}`;
            if (existingKeys.has(k)) continue;
            existingKeys.add(k);
            collected.push({
              date: d, title: ti,
              category: normalizeCategory(e.category),
              description: typeof e.description === 'string' ? e.description : undefined,
            });
            newCount++;
          }
        } catch (e: any) {
          setAiRangeStatus(`${mo}: ${e.message}`);
        }
        await sleep(150);
      }
      setAiRangeEvents(prev => [...prev, ...collected]);
      setAiRangeStatus(`✓ Готово. Новых: ${newCount}.`);
    } catch (e: any) {
      setAiRangeStatus(`Ошибка: ${e.message}`);
    } finally {
      setAiRangeLoading(false);
    }
  }

  function clearAiRangeEvents() {
    if (!confirm('Удалить все AI-события из локального хранилища?')) return;
    setAiRangeEvents([]);
    setAiRangeStatus('AI-события очищены.');
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
    setPopupDate(null);
  }

  // ===== Popup =====
  const popupAgg = useMemo(() => {
    if (!popupDate) return null;
    const vals: { tk: string; v: number }[] = [];
    for (const sym of loadedTickers) {
      const m = prices[sym] || {};
      const idx = tradingDates.indexOf(popupDate);
      if (idx <= 0) continue;
      const p = m[popupDate], pp = m[tradingDates[idx - 1]];
      if (p && pp) vals.push({ tk: sym, v: p / pp - 1 });
    }
    if (!vals.length) return null;
    vals.sort((a, b) => b.v - a.v);
    const avg = vals.reduce((s, x) => s + x.v, 0) / vals.length;
    return { avg, leader: vals[0], outsider: vals[vals.length - 1] };
  }, [popupDate, prices, loadedTickers, tradingDates]);

  useEffect(() => {
    if (!popupDate) return;
    if (!aiNews[popupDate] && !aiNewsLoading[popupDate]) loadAiNews(popupDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupDate]);

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
      if (e.key === 'Escape') setPopupDate(null);
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
        <div className="hm-h2">FMP <b>Heatmap</b> · дневные доходности × события</div>

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
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="hm-fld">
              <label>До</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
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
            <div className="hm-fld">
              <label>Опции</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 12 }}>
                <input type="checkbox" checked={fetchGrades}
                  onChange={e => setFetchGrades(e.target.checked)} />
                Тянуть рейтинги аналитиков
              </label>
            </div>

            <div className="hm-drawer-full">
              <label style={{ display: 'block', fontSize: 10.5, color: 'var(--hm-tx3)',
                  textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 4 }}>
                AI-события для диапазона
              </label>
              <div className="hm-drawer-row">
                <span className="hm-muted" style={{ fontSize: 12 }}>
                  AI-событий накоплено: <b style={{ color: 'var(--hm-tx)' }}>{aiRangeEvents.length}</b>
                </span>
                <button className="hm-ghost primary" onClick={aiFillEvents} disabled={aiRangeLoading}>
                  {aiRangeLoading ? 'Идёт поиск…' : '🤖 Найти события (помесячно)'}
                </button>
                <button className="hm-ghost" onClick={clearAiRangeEvents}
                  disabled={aiRangeLoading || !aiRangeEvents.length}>Очистить</button>
                {aiRangeStatus && <span className="hm-status">{aiRangeStatus}</span>}
              </div>
            </div>

            <div className="hm-drawer-full hm-fld">
              <label>Свои события (JSON или `YYYY-MM-DD | заголовок | категория` на строку)</label>
              <textarea value={customEventsRaw} onChange={e => setCustomEventsRaw(e.target.value)}
                placeholder='2024-05-10 | CPI выше прогноза | macro' />
            </div>
          </div>
        </div>

        {/* Control row */}
        {tradingDates.length > 0 && (
          <div className="hm-ctl">
            {anchorDate ? (
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
            ) : (
              <span className="hm-mode">
                Режим: <b>дневная доходность</b>. Клик по дате → карточка дня (новости, важное, якорь).
              </span>
            )}
          </div>
        )}

        {/* KPIs */}
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
            <div className="hm-kpi">
              <div className="k">Отмечено важным</div>
              <div className="v" style={{ color: 'var(--hm-imp)' }}>{kpi.important}</div>
              <div className="vsub">из {kpi.eventsInRange} событий</div>
            </div>
          </div>
        )}

        {/* Heatmap */}
        {!tradingDates.length ? (
          <div className="hm-kpi" style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--hm-tx3)' }}>
            Нажмите «↻ Загрузить» — получим дневные цены закрытия для выбранных тикеров и интервала.
          </div>
        ) : (
          <div className="hm-gridwrap" ref={scrollRef}>
            <table className="hm-table">
              <thead>
                <tr>
                  <th className="tk">Тикер</th>
                  {tradingDates.map(d => {
                    const evs = eventsMap[d];
                    const imp = importantDays.has(d);
                    const isAnchor = anchorDate === d;
                    return (
                      <th key={d}>
                        <div
                          className={`hm-dh ${isAnchor ? 'anchor' : ''} ${imp ? 'imp' : ''}`}
                          onClick={() => setPopupDate(d)}
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
                        const cls = `${imp ? 'impcol ' : ''}${isAnchor ? 'anchorcol ' : ''}${gItems?.length ? 'hm-cell-grade ' : ''}`;
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
        )}

        {/* Legend */}
        {tradingDates.length > 0 && (
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
        )}
      </div>

      {/* Tooltip */}
      <div ref={tipRef} className="hm-tip" />

      {/* Popup */}
      <div className={`hm-backdrop ${popupDate ? 'open' : ''}`}
        onClick={e => { if (e.target === e.currentTarget) setPopupDate(null); }}>
        {popupDate && (
          <div className="hm-pop">
            <div className="hm-pop-h">
              <div>
                <div className="d">{popupDate} <span style={{ fontSize: 12, color: 'var(--hm-tx3)', fontWeight: 400 }}>· {weekdayShort(popupDate)}</span></div>
                <div className="wd">
                  {eventsMap[popupDate]?.length
                    ? eventsMap[popupDate].map((e, i) => (
                      <span key={i}>
                        <span style={{ color: EVENT_COLORS[e.category] }}>●</span> {e.title}
                        {i < eventsMap[popupDate].length - 1 ? '; ' : ''}
                      </span>
                    ))
                    : <span style={{ color: 'var(--hm-tx3)' }}>событий нет в курированном списке</span>}
                </div>
              </div>
              <button className="hm-xb" onClick={() => setPopupDate(null)}>✕</button>
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
                  className={importantDays.has(popupDate) ? 'on-imp' : ''}
                  onClick={() => toggleImportant(popupDate)}>
                  {importantDays.has(popupDate) ? '★ Снять важное' : '☆ Отметить важным'}
                </button>
                <button
                  className={anchorDate === popupDate ? 'on-anc' : ''}
                  onClick={() => setAnchorAndClose(anchorDate === popupDate ? null : popupDate)}>
                  ⚓ {anchorDate === popupDate ? 'Снять якорь' : 'Сделать якорем'}
                </button>
              </div>
              <div className="hm-nw-h">
                <span>Новости дня</span>
                <span className="src">источник: aimlapi</span>
              </div>
              {aiNewsLoading[popupDate] ? (
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
              ) : aiNewsError[popupDate] ? (
                <div className="hm-error" style={{ padding: '8px 0' }}>
                  {aiNewsError[popupDate]} · <a href="#" onClick={e => { e.preventDefault(); loadAiNews(popupDate, true); }}
                    style={{ color: 'var(--hm-acc)' }}>повторить</a>
                </div>
              ) : aiNews[popupDate] ? (
                <>
                  {aiNews[popupDate].summary && (
                    <div style={{ fontSize: 12.5, color: 'var(--hm-tx2)', marginBottom: 8, lineHeight: 1.5 }}>
                      {aiNews[popupDate].summary}
                    </div>
                  )}
                  {aiNews[popupDate].items.length === 0 && (
                    <div className="hm-muted" style={{ fontSize: 12 }}>AI не вернул событий для этого дня.</div>
                  )}
                  {aiNews[popupDate].items.map((it, i) => {
                    const cat = normalizeCategory(it.category);
                    const c = EVENT_COLORS[cat];
                    return (
                      <div key={i} className="hm-news-item">
                        <div className="ic" style={{ background: c + '22', color: c }}>
                          {(EVENT_LABELS[cat] || '?').slice(0, 1)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="ti">{it.title}</div>
                          {it.description && (
                            <div className="me" style={{ color: 'var(--hm-tx2)', lineHeight: 1.4 }}>
                              {it.description}
                            </div>
                          )}
                          <div className="me">
                            <span className="hm-badge" style={{ background: c + '22', color: c }}>
                              {EVENT_LABELS[cat]}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 10 }}>
                    <button className="hm-ghost" onClick={() => loadAiNews(popupDate, true)}>
                      🔄 Обновить (AI)
                    </button>
                  </div>
                </>
              ) : (
                <div className="hm-muted" style={{ fontSize: 12 }}>Нажмите для загрузки новостей дня (AI).</div>
              )}

              {/* Рейтинги аналитиков на эту дату — поверх любых тикеров */}
              {(() => {
                const allG: { tk: string; g: GradeItem }[] = [];
                for (const t of loadedTickers) {
                  for (const g of (grades[t]?.[popupDate] || [])) allG.push({ tk: t, g });
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
      </div>
    </div>
  );
}
