'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MARKET_EVENTS, EVENT_COLORS, EVENT_LABELS,
  eventsByDate, type MarketEvent, type EventCategory,
} from '@/lib/market-events';

type PriceRow = { date: string; price: number };
type PricesBySymbol = Record<string, Record<string, number>>; // symbol -> date -> close

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

const DEFAULT_TICKERS = 'SPY,QQQ,IWM,GLD,USO,TLT,XLE,XLF,XLK,XLU';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function yearsAgoIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function cellColor(r: number | null, clamp: number): string {
  if (r == null || !isFinite(r)) return '#f5f5f5';
  const x = Math.max(-1, Math.min(1, r / clamp));
  const a = Math.abs(x);
  const alpha = 0.08 + 0.92 * a;
  if (x >= 0) return `rgba(22, 163, 74, ${alpha.toFixed(3)})`;
  return `rgba(220, 38, 38, ${alpha.toFixed(3)})`;
}
function textColorOn(_bg: string, r: number | null, clamp: number): string {
  if (r == null) return '#a3a3a3';
  return Math.abs(r / clamp) > 0.55 ? '#ffffff' : '#171717';
}
function formatPct(v: number | null, digits = 2): string {
  if (v == null || !isFinite(v)) return '';
  return (v > 0 ? '+' : '') + (v * 100).toFixed(digits) + '%';
}
function monthShort(m: number): string {
  return ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][m];
}
function gradesActionColor(action?: string): string {
  if (!action) return '#737373';
  const a = action.toLowerCase();
  if (a.includes('up')) return '#16a34a';
  if (a.includes('down')) return '#dc2626';
  if (a.includes('init')) return '#2563eb';
  if (a.includes('maint') || a.includes('reit')) return '#737373';
  return '#737373';
}

export default function HeatmapPage() {
  const [tickersInput, setTickersInput] = useState(DEFAULT_TICKERS);
  const [fromDate, setFromDate] = useState(yearsAgoIso(2));
  const [toDate, setToDate] = useState(todayIso());
  const [cellWidth, setCellWidth] = useState(40);
  const [rowHeight, setRowHeight] = useState(32);
  const [clampPct, setClampPct] = useState(3);
  const [clampPctAnchor, setClampPctAnchor] = useState(10);
  const [customEventsRaw, setCustomEventsRaw] = useState('');
  const [mode, setMode] = useState<'daily' | 'cumulative'>('daily');
  const [fetchGrades, setFetchGrades] = useState(true);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<PricesBySymbol>({});
  const [grades, setGrades] = useState<GradesBySymbol>({});
  const [loadedTickers, setLoadedTickers] = useState<string[]>([]);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; sym: string; date: string } | null>(null);

  // Кэш AI-новостей по дате
  const [aiNews, setAiNews] = useState<Record<string, AiNews>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const tickers = useMemo(
    () => tickersInput.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean),
    [tickersInput]
  );

  const customEvents = useMemo<MarketEvent[]>(() => {
    if (!customEventsRaw.trim()) return [];
    try {
      const parsed = JSON.parse(customEventsRaw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((e: any) => e && typeof e.date === 'string' && typeof e.title === 'string')
          .map((e: any) => ({
            date: e.date,
            title: e.title,
            category: (e.category || 'other') as EventCategory,
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
        out.push({
          date: parts[0], title: parts[1],
          category: (parts[2] as EventCategory) || 'other',
        });
      }
    }
    return out;
  }, [customEventsRaw]);

  const allEvents = useMemo(() => [...MARKET_EVENTS, ...customEvents], [customEvents]);
  const eventsMap = useMemo(() => eventsByDate(allEvents), [allEvents]);

  const tradingDates = useMemo<string[]>(() => {
    if (!loadedTickers.length) return [];
    const set = new Set<string>();
    for (const sym of loadedTickers) {
      const m = prices[sym];
      if (!m) continue;
      for (const d of Object.keys(m)) {
        if (d >= fromDate && d <= toDate) set.add(d);
      }
    }
    return Array.from(set).sort();
  }, [prices, loadedTickers, fromDate, toDate]);

  // Если режим cumulative, но якоря нет — взять первую дату
  useEffect(() => {
    if (mode === 'cumulative' && !anchorDate && tradingDates.length) {
      setAnchorDate(tradingDates[0]);
    }
    if (mode === 'daily' && anchorDate) {
      setAnchorDate(null);
    }
  }, [mode, anchorDate, tradingDates]);

  const matrix = useMemo(() => {
    const out: Record<string, (number | null)[]> = {};
    const useAnchor = mode === 'cumulative' && anchorDate;
    for (const sym of loadedTickers) {
      const row: (number | null)[] = [];
      const m = prices[sym] || {};
      if (useAnchor) {
        const anchorPrice = m[anchorDate!];
        for (let i = 0; i < tradingDates.length; i++) {
          const d = tradingDates[i];
          const p = m[d];
          if (anchorPrice && p && d >= anchorDate!) row.push(p / anchorPrice - 1);
          else row.push(null);
        }
      } else {
        let prev: number | null = null;
        for (let i = 0; i < tradingDates.length; i++) {
          const d = tradingDates[i];
          const p = m[d] ?? null;
          if (p != null && prev != null) row.push(p / prev - 1);
          else row.push(null);
          if (p != null) prev = p;
        }
      }
      out[sym] = row;
    }
    return out;
  }, [prices, loadedTickers, tradingDates, anchorDate, mode]);

  const clamp = (mode === 'cumulative' && anchorDate) ? clampPctAnchor / 100 : clampPct / 100;

  async function loadAll() {
    setLoading(true);
    setError(null);
    setStatus('');
    if (mode === 'cumulative') setAnchorDate(null); // переустановится после загрузки
    const nextPrices: PricesBySymbol = {};
    const nextGrades: GradesBySymbol = {};
    const loaded: string[] = [];
    try {
      for (let i = 0; i < tickers.length; i++) {
        const sym = tickers[i];
        setStatus(`${i + 1}/${tickers.length} ${sym} — цены...`);
        const url = `/api/fmp/historical-price-eod?symbol=${encodeURIComponent(sym)}` +
                    `&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
        const res = await fetch(url).then(r => r.json());
        if (res?.error) {
          setError(prev => (prev ? prev + '; ' : '') + `${sym} prices: ${res.error}`);
          continue;
        }
        const arr: PriceRow[] = Array.isArray(res) ? res : (res?.historical || []);
        if (!arr.length) {
          setError(prev => (prev ? prev + '; ' : '') + `${sym}: нет цен`);
          continue;
        }
        const map: Record<string, number> = {};
        for (const r of arr) {
          if (r && typeof r.date === 'string' && typeof r.price === 'number') map[r.date] = r.price;
        }
        nextPrices[sym] = map;

        // Загрузка grades (опционально)
        if (fetchGrades) {
          setStatus(`${i + 1}/${tickers.length} ${sym} — grades...`);
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
          } catch {
            // тихо игнорируем
          }
        }
        loaded.push(sym);
        await sleep(50);
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

  async function loadAiNews(date: string) {
    if (aiNews[date]) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const url = `/api/ai/news?date=${encodeURIComponent(date)}` +
                  `&tickers=${encodeURIComponent(tickersInput)}`;
      const res = await fetch(url).then(r => r.json());
      if (res?.error) { setAiError(res.error); return; }
      setAiNews(prev => ({ ...prev, [date]: res }));
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  }

  const monthGroups = useMemo(() => {
    const groups: { label: string; span: number; startIdx: number }[] = [];
    let cur: { label: string; span: number; startIdx: number } | null = null;
    for (let i = 0; i < tradingDates.length; i++) {
      const d = tradingDates[i];
      const y = d.slice(0, 4);
      const m = parseInt(d.slice(5, 7), 10) - 1;
      const label = `${monthShort(m)} ${y}`;
      if (!cur || cur.label !== label) {
        if (cur) groups.push(cur);
        cur = { label, span: 1, startIdx: i };
      } else cur.span += 1;
    }
    if (cur) groups.push(cur);
    return groups;
  }, [tradingDates]);

  // События в видимом диапазоне (для ленты снизу)
  const eventsInRange = useMemo(() => {
    return allEvents
      .filter(e => e.date >= fromDate && e.date <= toDate)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allEvents, fromDate, toDate]);

  const tableWidth = 80 + tradingDates.length * cellWidth;

  const hoverData = useMemo(() => {
    if (!hover) return null;
    const m = prices[hover.sym] || {};
    const price = m[hover.date] ?? null;
    const row = matrix[hover.sym] || [];
    const idx = tradingDates.indexOf(hover.date);
    const val = idx >= 0 ? row[idx] : null;
    const evs = eventsMap[hover.date] || [];
    const gs = (grades[hover.sym] || {})[hover.date] || [];
    const daysFromAnchor = anchorDate && idx >= 0
      ? tradingDates.filter(d => d >= anchorDate && d <= hover.date).length - 1 : null;
    return { price, val, events: evs, grades: gs, daysFromAnchor };
  }, [hover, prices, matrix, tradingDates, eventsMap, grades, anchorDate]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tradingDates.length && scrollRef.current && mode === 'daily') {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [tradingDates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Прокрутить к дате (например, при клике на событие в ленте)
  function scrollToDate(date: string) {
    const idx = tradingDates.indexOf(date);
    if (idx < 0 || !scrollRef.current) return;
    const left = 80 + idx * cellWidth - scrollRef.current.clientWidth / 2;
    scrollRef.current.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }

  // Высоты sticky-рядов
  const H_MONTH = 20;
  const H_EVENTS_TXT = cellWidth >= 28 ? 100 : 0; // вертикальный текст событий — только при достаточной ширине
  const H_DOTS = 16;
  const H_DATE = 32;
  const TOP_MONTH = 0;
  const TOP_EVENTS_TXT = TOP_MONTH + H_MONTH;
  const TOP_DOTS = TOP_EVENTS_TXT + H_EVENTS_TXT;
  const TOP_DATE = TOP_DOTS + H_DOTS;

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">Heatmap — дневные доходности тикеров × дни</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Цвет ячейки — % изменения цены закрытия. Переключатель «Дневная / Накопительная» выбирает режим.
          В накопительном — доходность от выбранной даты-якоря (клик на день в шапке). Цветные точки и
          вертикальные подписи сверху — значимые события. Маркеры с правым нижним углом ячеек — изменения
          рейтингов аналитиков (FMP grades).
        </p>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Тикеры (через запятую)</span>
            <input type="text" className="input w-[420px]"
                   value={tickersInput}
                   onChange={e => setTickersInput(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">От</span>
            <input type="date" className="input" value={fromDate}
                   onChange={e => setFromDate(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">До</span>
            <input type="date" className="input" value={toDate}
                   onChange={e => setToDate(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input type="checkbox" checked={fetchGrades}
                   onChange={e => setFetchGrades(e.target.checked)} />
            <span className="text-sm">Тянуть рейтинги аналитиков (FMP grades)</span>
          </label>
          <button className="btn-primary" onClick={loadAll} disabled={loading || !tickers.length}>
            {loading ? 'Загрузка...' : '▶ Загрузить'}
          </button>
          {status && <span className="text-sm text-blue-600">{status}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>

        <div className="flex flex-wrap gap-4 items-end mt-3">
          <div className="flex flex-col">
            <span className="label">Режим</span>
            <div className="flex gap-1 mt-0.5">
              <button
                className={`btn ${mode === 'daily' ? 'bg-blue-600 text-white border-blue-700' : ''}`}
                onClick={() => setMode('daily')}
              >Дневная</button>
              <button
                className={`btn ${mode === 'cumulative' ? 'bg-blue-600 text-white border-blue-700' : ''}`}
                onClick={() => setMode('cumulative')}
                disabled={!tradingDates.length}
              >Накопительная</button>
            </div>
          </div>
          <label className="flex flex-col">
            <span className="label">Ширина клетки, px</span>
            <input type="number" className="input w-20" min={6} max={80}
                   value={cellWidth}
                   onChange={e => setCellWidth(parseInt(e.target.value) || 40)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Высота строки, px</span>
            <input type="number" className="input w-20" min={16} max={80}
                   value={rowHeight}
                   onChange={e => setRowHeight(parseInt(e.target.value) || 32)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Шкала ±% (дневная)</span>
            <input type="number" className="input w-20" min={0.5} step={0.5}
                   value={clampPct}
                   onChange={e => setClampPct(parseFloat(e.target.value) || 3)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Шкала ±% (накоп.)</span>
            <input type="number" className="input w-20" min={1} step={1}
                   value={clampPctAnchor}
                   onChange={e => setClampPctAnchor(parseFloat(e.target.value) || 10)} />
          </label>
          {mode === 'cumulative' && (
            <div className="flex flex-col">
              <span className="label">Якорь</span>
              <span className="text-sm font-mono bg-yellow-100 border border-yellow-400 rounded px-2 py-1">
                {anchorDate || '—'}
              </span>
            </div>
          )}
        </div>

        {/* AI новости */}
        {anchorDate && (
          <div className="mt-3 border border-neutral-200 rounded p-3 bg-neutral-50">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold">Новости за {anchorDate}</span>
              <button className="btn" disabled={aiLoading} onClick={() => loadAiNews(anchorDate)}>
                {aiLoading ? 'Запрос...' : (aiNews[anchorDate] ? '🔄 Обновить (AI)' : '🤖 Запросить AI')}
              </button>
              {aiError && <span className="text-xs text-red-600">{aiError}</span>}
              {!process.env.NEXT_PUBLIC_AIMLAPI_HINT_OFF && !aiNews[anchorDate] && (
                <span className="text-xs text-neutral-500">
                  требуется env <code>AIMLAPI_KEY</code> (aimlapi.com)
                </span>
              )}
            </div>
            {aiNews[anchorDate] && (
              <div className="mt-2 text-sm space-y-2">
                {aiNews[anchorDate].summary && (
                  <p className="text-neutral-800">{aiNews[anchorDate].summary}</p>
                )}
                <ul className="space-y-1">
                  {aiNews[anchorDate].items.map((it, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <span className="inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                            style={{ background: EVENT_COLORS[(it.category as EventCategory) || 'other'] || '#737373' }} />
                      <span>
                        <span className="font-semibold">{it.title}</span>
                        {it.description && (
                          <span className="text-neutral-600"> — {it.description}</span>
                        )}
                      </span>
                    </li>
                  ))}
                  {!aiNews[anchorDate].items.length && (
                    <li className="text-neutral-500 text-xs">AI не вернул событий.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        <details className="mt-3">
          <summary className="text-sm cursor-pointer text-neutral-700">
            Свои события ({customEvents.length})
            <span className="text-xs text-neutral-500 ml-2">
              JSON или строки `YYYY-MM-DD | заголовок | категория`
            </span>
          </summary>
          <textarea
            className="input w-full mt-2 font-mono text-xs"
            rows={4}
            placeholder='2024-05-10 | CPI выше прогноза | monetary&#10;или JSON: [{"date":"2024-05-10","title":"CPI","category":"monetary"}]'
            value={customEventsRaw}
            onChange={e => setCustomEventsRaw(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Категории: geopolitics, monetary, crisis, pandemic, policy, other
          </p>
        </details>

        <div className="flex flex-wrap gap-3 mt-3 text-xs">
          {(Object.keys(EVENT_COLORS) as EventCategory[]).map(k => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: EVENT_COLORS[k] }} />
              <span className="text-neutral-700">{EVENT_LABELS[k]}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Полноширинный контейнер */}
      <div
        className="relative bg-white border border-neutral-200 rounded-lg shadow-sm overflow-hidden"
        style={{ width: '100vw', left: '50%', transform: 'translateX(-50%)' }}
      >
        {!tradingDates.length ? (
          <div className="p-6 text-sm text-neutral-500">
            Нажмите «Загрузить», чтобы получить дневные цены закрытия для выбранных тикеров и интервала.
          </div>
        ) : (
          <div ref={scrollRef} className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 100px)' }}>
            <div style={{ width: tableWidth, position: 'relative' }}>
              {/* Месяцы */}
              <div className="flex sticky z-30 bg-neutral-100 border-b border-neutral-300"
                   style={{ top: TOP_MONTH }}>
                <div className="sticky left-0 z-40 bg-neutral-100 border-r border-neutral-300"
                     style={{ width: 80, minWidth: 80, height: H_MONTH }} />
                {monthGroups.map((g, i) => (
                  <div key={i}
                       className="text-[10px] text-neutral-700 px-1 border-r border-neutral-200 whitespace-nowrap overflow-hidden font-semibold"
                       style={{ width: g.span * cellWidth, minWidth: g.span * cellWidth, height: H_MONTH, lineHeight: `${H_MONTH}px` }}>
                    {g.span * cellWidth >= 40 ? g.label : ''}
                  </div>
                ))}
              </div>

              {/* Тексты событий (вертикальные) */}
              {H_EVENTS_TXT > 0 && (
                <div className="flex sticky z-30 bg-white border-b border-neutral-200"
                     style={{ top: TOP_EVENTS_TXT }}>
                  <div className="sticky left-0 z-40 bg-white border-r border-neutral-300 text-[10px] text-neutral-500 px-2 flex items-center"
                       style={{ width: 80, minWidth: 80, height: H_EVENTS_TXT }}>
                    События
                  </div>
                  {tradingDates.map(d => {
                    const evs = eventsMap[d];
                    const main = evs && evs[0];
                    return (
                      <div key={d}
                           className="border-r border-neutral-100 relative overflow-hidden"
                           style={{ width: cellWidth, minWidth: cellWidth, height: H_EVENTS_TXT }}>
                        {main && (
                          <div
                            className="absolute inset-0 flex items-end justify-center pb-1"
                            title={evs.map(e => `${e.title}${e.description ? ': ' + e.description : ''}`).join('\n')}
                          >
                            <span
                              className="text-[10px] font-medium leading-tight whitespace-nowrap"
                              style={{
                                writingMode: 'vertical-rl',
                                transform: 'rotate(180deg)',
                                color: EVENT_COLORS[main.category],
                                maxHeight: H_EVENTS_TXT - 6,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {main.title}{evs.length > 1 ? ` +${evs.length - 1}` : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Точки событий */}
              <div className="flex sticky z-30 bg-white border-b border-neutral-200"
                   style={{ top: TOP_DOTS }}>
                <div className="sticky left-0 z-40 bg-white border-r border-neutral-300 text-[10px] text-neutral-500 px-2 flex items-center"
                     style={{ width: 80, minWidth: 80, height: H_DOTS }}>
                  Маркеры
                </div>
                {tradingDates.map(d => {
                  const evs = eventsMap[d];
                  return (
                    <div key={d}
                         className="border-r border-neutral-100"
                         style={{ width: cellWidth, minWidth: cellWidth, height: H_DOTS }}>
                      {evs && evs.length ? (
                        <div className="flex justify-center items-center h-full gap-0.5">
                          {evs.slice(0, 4).map((e, j) => (
                            <span key={j}
                                  className="inline-block w-1.5 h-1.5 rounded-full"
                                  style={{ background: EVENT_COLORS[e.category] }} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {/* Даты (кликабельные) */}
              <div className="flex sticky z-30 bg-white border-b border-neutral-300"
                   style={{ top: TOP_DATE }}>
                <div className="sticky left-0 z-40 bg-white border-r border-neutral-300 text-xs font-semibold px-2 flex items-center"
                     style={{ width: 80, minWidth: 80, height: H_DATE }}>
                  Тикер
                </div>
                {tradingDates.map(d => {
                  const day = d.slice(8, 10);
                  const isAnchor = anchorDate === d;
                  const isWeekStart = parseInt(day, 10) <= 7;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        if (anchorDate === d) {
                          setMode('daily');
                          setAnchorDate(null);
                        } else {
                          setMode('cumulative');
                          setAnchorDate(d);
                        }
                      }}
                      title={`${d} — клик: сделать якорем`}
                      className={`border-r text-[10px] font-mono cursor-pointer transition-colors
                        ${isAnchor ? 'bg-yellow-300 text-black border-yellow-500 font-bold'
                                   : 'bg-white hover:bg-blue-50 border-neutral-100'}`}
                      style={{
                        width: cellWidth, minWidth: cellWidth, height: H_DATE,
                        padding: 0,
                        writingMode: cellWidth < 22 ? 'vertical-rl' : undefined,
                        textOrientation: 'mixed' as any,
                        borderLeftWidth: isWeekStart ? 1 : 0,
                        borderLeftColor: '#e5e5e5',
                      }}
                    >
                      {cellWidth >= 36 ? d.slice(5) : (cellWidth >= 22 ? day : d.slice(5))}
                    </button>
                  );
                })}
              </div>

              {/* Строки тикеров */}
              {loadedTickers.map(sym => {
                const row = matrix[sym] || [];
                const gMap = grades[sym] || {};
                return (
                  <div key={sym} className="flex border-b border-neutral-100">
                    <div className="sticky left-0 z-20 bg-white border-r border-neutral-300 font-mono text-sm font-semibold px-2 flex items-center"
                         style={{ width: 80, minWidth: 80, height: rowHeight }}>
                      {sym}
                    </div>
                    {tradingDates.map((d, i) => {
                      const v = row[i];
                      const bg = cellColor(v, clamp);
                      const fg = textColorOn(bg, v, clamp);
                      const isAnchorCol = anchorDate === d;
                      const gItems = gMap[d];
                      return (
                        <div
                          key={d}
                          onMouseEnter={ev => setHover({
                            x: ev.clientX, y: ev.clientY, sym, date: d,
                          })}
                          onMouseMove={ev => setHover(h => h ? { ...h, x: ev.clientX, y: ev.clientY } : null)}
                          onMouseLeave={() => setHover(null)}
                          className="border-r border-neutral-50 cursor-default relative"
                          style={{
                            width: cellWidth, minWidth: cellWidth,
                            height: rowHeight,
                            background: bg,
                            color: fg,
                            outline: isAnchorCol ? '2px solid #eab308' : undefined,
                            outlineOffset: '-2px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: cellWidth >= 32 ? 11 : (cellWidth >= 24 ? 9 : 0),
                            fontFamily: 'ui-monospace, monospace',
                          }}
                        >
                          {cellWidth >= 24 && v != null ? (v * 100).toFixed(cellWidth >= 36 ? 2 : 1) : ''}
                          {gItems && gItems.length > 0 && (
                            <span
                              className="absolute bottom-0 right-0"
                              style={{
                                width: 6, height: 6,
                                background: gradesActionColor(gItems[0].action),
                                clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
                              }}
                              title={`Рейтинги (${gItems.length}): ` +
                                gItems.map(g => `${g.gradingCompany || '?'}: ${g.previousGrade || '—'} → ${g.newGrade || '—'} (${g.action || '?'})`).join('; ')}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tooltip */}
        {hover && hoverData && (
          <div
            className="fixed z-50 bg-neutral-900 text-white text-xs rounded shadow-lg p-2 pointer-events-none"
            style={{
              left: Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 360),
              top: Math.min(hover.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240),
              maxWidth: 360,
            }}
          >
            <div className="font-semibold">{hover.sym} · {hover.date}
              {hoverData.daysFromAnchor != null && (
                <span className="text-neutral-300 font-normal"> · T+{hoverData.daysFromAnchor}</span>
              )}
            </div>
            <div className="font-mono">
              close: {hoverData.price != null ? hoverData.price.toFixed(2) : '—'}
              <span className="ml-2">
                {(mode === 'cumulative' && anchorDate)
                  ? <>от якоря: <b>{formatPct(hoverData.val, 2)}</b></>
                  : <>день/день: <b>{formatPct(hoverData.val, 2)}</b></>}
              </span>
            </div>
            {hoverData.events.length > 0 && (
              <div className="mt-1 pt-1 border-t border-neutral-700">
                {hoverData.events.map((e, i) => (
                  <div key={i} className="flex gap-1 items-start">
                    <span className="inline-block w-2 h-2 rounded-full mt-1 flex-shrink-0"
                          style={{ background: EVENT_COLORS[e.category] }} />
                    <div>
                      <div className="font-semibold">{e.title}</div>
                      {e.description && (
                        <div className="text-neutral-300 text-[11px]">{e.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hoverData.grades.length > 0 && (
              <div className="mt-1 pt-1 border-t border-neutral-700">
                <div className="text-neutral-300 text-[10px] mb-0.5">Рейтинги аналитиков:</div>
                {hoverData.grades.map((g, i) => (
                  <div key={i} className="text-[11px]">
                    <span style={{ color: gradesActionColor(g.action) }}>●</span>{' '}
                    <span className="font-semibold">{g.gradingCompany || '?'}</span>
                    {': '}{g.previousGrade || '—'} → {g.newGrade || '—'}
                    {g.action && <span className="text-neutral-400"> ({g.action})</span>}
                  </div>
                ))}
              </div>
            )}
            {mode === 'daily' && (
              <div className="text-neutral-400 mt-1 text-[10px]">
                клик на дату вверху → накопительная доходность от этого дня
              </div>
            )}
          </div>
        )}
      </div>

      {/* Лента событий */}
      {eventsInRange.length > 0 && (
        <section className="card mt-4">
          <h3 className="font-semibold mb-2">
            Лента событий ({eventsInRange.length} в интервале {fromDate} — {toDate})
          </h3>
          <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-100">
                <tr>
                  <th className="text-left p-2 border w-28">Дата</th>
                  <th className="text-left p-2 border w-40">Категория</th>
                  <th className="text-left p-2 border">Событие</th>
                  <th className="text-left p-2 border w-20">Действия</th>
                </tr>
              </thead>
              <tbody>
                {eventsInRange.map((e, i) => (
                  <tr key={`${e.date}-${i}`} className="hover:bg-neutral-50">
                    <td className="p-2 border font-mono">{e.date}</td>
                    <td className="p-2 border">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ background: EVENT_COLORS[e.category] }} />
                        {EVENT_LABELS[e.category]}
                      </span>
                    </td>
                    <td className="p-2 border">
                      <div className="font-medium">{e.title}</div>
                      {e.description && (
                        <div className="text-xs text-neutral-600 mt-0.5">{e.description}</div>
                      )}
                    </td>
                    <td className="p-2 border">
                      <button
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => {
                          setMode('cumulative');
                          setAnchorDate(e.date);
                          scrollToDate(e.date);
                        }}
                      >
                        → якорь
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
