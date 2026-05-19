'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MARKET_EVENTS, EVENT_COLORS, EVENT_LABELS,
  eventsByDate, type MarketEvent, type EventCategory,
} from '@/lib/market-events';

type PriceRow = { date: string; price: number };
type PricesBySymbol = Record<string, Record<string, number>>; // symbol -> date -> close

const DEFAULT_TICKERS = 'SPY,QQQ,IWM,GLD,USO,TLT,XLE,XLF,XLK,XLU';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function yearsAgoIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// Цвет ячейки для дневной доходности: красный <-> зелёный, интенсивность по |r|/clamp.
function cellColor(r: number | null, clamp: number): string {
  if (r == null || !isFinite(r)) return '#f5f5f5';
  const x = Math.max(-1, Math.min(1, r / clamp));
  const a = Math.abs(x);
  // Перцептивно более яркая шкала: насыщенный цвет для |x| → 1
  const alpha = 0.08 + 0.92 * a;
  if (x >= 0) {
    // зелёный
    return `rgba(22, 163, 74, ${alpha.toFixed(3)})`;
  } else {
    return `rgba(220, 38, 38, ${alpha.toFixed(3)})`;
  }
}

function textColorOn(bg: string, r: number | null, clamp: number): string {
  if (r == null) return '#a3a3a3';
  const x = Math.abs((r / clamp));
  return x > 0.55 ? '#ffffff' : '#171717';
}

function formatPct(v: number | null, digits = 2): string {
  if (v == null || !isFinite(v)) return '';
  return (v > 0 ? '+' : '') + (v * 100).toFixed(digits) + '%';
}

function monthShort(m: number): string {
  return ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][m];
}

export default function HeatmapPage() {
  const [tickersInput, setTickersInput] = useState(DEFAULT_TICKERS);
  const [fromDate, setFromDate] = useState(yearsAgoIso(2));
  const [toDate, setToDate] = useState(todayIso());
  const [cellWidth, setCellWidth] = useState(14);
  const [rowHeight, setRowHeight] = useState(28);
  const [clampPct, setClampPct] = useState(3);          // ±% для шкалы дневной
  const [clampPctAnchor, setClampPctAnchor] = useState(10); // ±% для шкалы от якоря
  const [customEventsRaw, setCustomEventsRaw] = useState('');

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<PricesBySymbol>({});
  const [loadedTickers, setLoadedTickers] = useState<string[]>([]);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; sym: string; date: string } | null>(null);

  const tickers = useMemo(
    () => tickersInput.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean),
    [tickersInput]
  );

  // === Парсинг пользовательских событий ===
  const customEvents = useMemo<MarketEvent[]>(() => {
    if (!customEventsRaw.trim()) return [];
    // Пробуем JSON: [{date,title,category?,description?},...]
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
    // Иначе — line-based: YYYY-MM-DD | title | category(optional)
    const out: MarketEvent[] = [];
    for (const line of customEventsRaw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const parts = t.split('|').map(s => s.trim());
      if (parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
        out.push({
          date: parts[0],
          title: parts[1],
          category: (parts[2] as EventCategory) || 'other',
        });
      }
    }
    return out;
  }, [customEventsRaw]);

  const allEvents = useMemo(() => [...MARKET_EVENTS, ...customEvents], [customEvents]);
  const eventsMap = useMemo(() => eventsByDate(allEvents), [allEvents]);

  // === Подмножество дат в выбранном интервале ===
  // Берём объединение всех торговых дат из загруженных тикеров.
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

  // === Матрица отображаемого значения (дневная или от якоря) ===
  const matrix = useMemo(() => {
    const out: Record<string, (number | null)[]> = {};
    for (const sym of loadedTickers) {
      const row: (number | null)[] = [];
      const m = prices[sym] || {};
      if (anchorDate) {
        const anchorPrice = m[anchorDate];
        for (let i = 0; i < tradingDates.length; i++) {
          const d = tradingDates[i];
          const p = m[d];
          if (anchorPrice && p && d >= anchorDate) {
            row.push(p / anchorPrice - 1);
          } else {
            row.push(null);
          }
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
  }, [prices, loadedTickers, tradingDates, anchorDate]);

  const clamp = anchorDate ? clampPctAnchor / 100 : clampPct / 100;

  // === Загрузка цен ===
  async function loadAll() {
    setLoading(true);
    setError(null);
    setStatus('');
    setAnchorDate(null);
    const next: PricesBySymbol = {};
    const loaded: string[] = [];
    try {
      for (let i = 0; i < tickers.length; i++) {
        const sym = tickers[i];
        setStatus(`${i + 1}/${tickers.length} ${sym}...`);
        const url = `/api/fmp/historical-price-eod?symbol=${encodeURIComponent(sym)}` +
                    `&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
        const res = await fetch(url).then(r => r.json());
        if (res?.error) {
          setError(`${sym}: ${res.error}`);
          continue;
        }
        const arr: PriceRow[] = Array.isArray(res) ? res : (res?.historical || []);
        if (!arr.length) {
          setError(prev => (prev ? prev + '; ' : '') + `${sym}: нет данных`);
          continue;
        }
        const map: Record<string, number> = {};
        for (const r of arr) {
          if (r && typeof r.date === 'string' && typeof r.price === 'number') {
            map[r.date] = r.price;
          }
        }
        next[sym] = map;
        loaded.push(sym);
        await sleep(50);
      }
      setPrices(next);
      setLoadedTickers(loaded);
      setStatus(`✓ Загружено ${loaded.length}/${tickers.length}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Группы месяцев для верхнего заголовка
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
      } else {
        cur.span += 1;
      }
    }
    if (cur) groups.push(cur);
    return groups;
  }, [tradingDates]);

  const tableWidth = 80 + tradingDates.length * cellWidth;

  // Текущее значение и контекст под курсором (для тултипа)
  const hoverData = useMemo(() => {
    if (!hover) return null;
    const m = prices[hover.sym] || {};
    const price = m[hover.date] ?? null;
    const row = matrix[hover.sym] || [];
    const idx = tradingDates.indexOf(hover.date);
    const val = idx >= 0 ? row[idx] : null;
    const evs = eventsMap[hover.date] || [];
    return { price, val, events: evs, daysFromAnchor: anchorDate && idx >= 0
      ? tradingDates.filter(d => d >= anchorDate && d <= hover.date).length - 1 : null };
  }, [hover, prices, matrix, tradingDates, eventsMap, anchorDate]);

  // Авто-скролл в конец после первой загрузки
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tradingDates.length && scrollRef.current && !anchorDate) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [tradingDates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">Heatmap — дневные доходности тикеров × дни</h2>
        <p className="text-xs text-neutral-500 mb-3">
          В строках — тикеры, в столбцах — дни. Цвет ячейки = % изменения цены закрытия ко вчерашнему закрытию.
          Клик на заголовок дня = выбрать его как «якорь»: ячейки покажут накопленную доходность с этого дня
          (удобно смотреть реакцию активов на событие на 1/5/10 дней вперёд). Повторный клик — снять.
          Цветные точки сверху столбцов — значимые события.
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
          <button className="btn-primary" onClick={loadAll} disabled={loading || !tickers.length}>
            {loading ? 'Загрузка...' : '▶ Загрузить'}
          </button>
          {status && <span className="text-sm text-blue-600">{status}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>

        <div className="flex flex-wrap gap-4 items-end mt-3">
          <label className="flex flex-col">
            <span className="label">Ширина клетки, px</span>
            <input type="number" className="input w-20" min={6} max={40}
                   value={cellWidth}
                   onChange={e => setCellWidth(parseInt(e.target.value) || 14)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Высота строки, px</span>
            <input type="number" className="input w-20" min={16} max={60}
                   value={rowHeight}
                   onChange={e => setRowHeight(parseInt(e.target.value) || 28)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Шкала ±% (дневная)</span>
            <input type="number" className="input w-20" min={0.5} step={0.5}
                   value={clampPct}
                   onChange={e => setClampPct(parseFloat(e.target.value) || 3)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Шкала ±% (от якоря)</span>
            <input type="number" className="input w-20" min={1} step={1}
                   value={clampPctAnchor}
                   onChange={e => setClampPctAnchor(parseFloat(e.target.value) || 10)} />
          </label>
          {anchorDate ? (
            <button className="btn" onClick={() => setAnchorDate(null)}>
              Снять якорь ({anchorDate})
            </button>
          ) : (
            <span className="text-xs text-neutral-500">Якорь не выбран — режим дневной доходности</span>
          )}
        </div>

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

      {/* Полноширинный контейнер: ломаем max-w-5xl родителя */}
      <div
        className="relative bg-white border border-neutral-200 rounded-lg shadow-sm overflow-hidden"
        style={{
          width: '100vw',
          left: '50%',
          transform: 'translateX(-50%)',
          marginLeft: 0,
        }}
      >
        {!tradingDates.length ? (
          <div className="p-6 text-sm text-neutral-500">
            Нажмите «Загрузить», чтобы получить дневные цены закрытия для выбранных тикеров и интервала.
          </div>
        ) : (
          <div ref={scrollRef} className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 100px)' }}>
            <div style={{ width: tableWidth, position: 'relative' }}>
              {/* === Верхняя строка: группы месяцев === */}
              <div className="flex sticky top-0 z-30 bg-neutral-100 border-b border-neutral-300">
                <div className="sticky left-0 z-40 bg-neutral-100 border-r border-neutral-300"
                     style={{ width: 80, minWidth: 80, height: 20 }} />
                {monthGroups.map((g, i) => (
                  <div key={i}
                       className="text-[10px] text-neutral-700 px-1 border-r border-neutral-200 whitespace-nowrap overflow-hidden"
                       style={{ width: g.span * cellWidth, minWidth: g.span * cellWidth, height: 20, lineHeight: '20px' }}>
                    {g.span * cellWidth >= 40 ? g.label : ''}
                  </div>
                ))}
              </div>

              {/* === Строка событий (маркеры) === */}
              <div className="flex sticky z-30 bg-white border-b border-neutral-200"
                   style={{ top: 20 }}>
                <div className="sticky left-0 z-40 bg-white border-r border-neutral-300 text-[10px] text-neutral-500 px-2 flex items-center"
                     style={{ width: 80, minWidth: 80, height: 16 }}>
                  События
                </div>
                {tradingDates.map((d, i) => {
                  const evs = eventsMap[d];
                  return (
                    <div key={d}
                         className="border-r border-neutral-100 relative"
                         style={{ width: cellWidth, minWidth: cellWidth, height: 16 }}>
                      {evs && evs.length ? (
                        <div className="flex justify-center items-center h-full gap-0.5">
                          {evs.slice(0, 3).map((e, j) => (
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

              {/* === Строка-заголовок: даты (кликабельные) === */}
              <div className="flex sticky z-30 bg-white border-b border-neutral-300"
                   style={{ top: 36 }}>
                <div className="sticky left-0 z-40 bg-white border-r border-neutral-300 text-xs font-semibold px-2 flex items-center"
                     style={{ width: 80, minWidth: 80, height: 32 }}>
                  Тикер
                </div>
                {tradingDates.map((d, i) => {
                  const day = d.slice(8, 10);
                  const isAnchor = anchorDate === d;
                  const isWeekStart = parseInt(day, 10) <= 7;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setAnchorDate(prev => prev === d ? null : d)}
                      title={`${d} — клик: сделать якорем`}
                      className={`border-r text-[9px] font-mono cursor-pointer transition-colors
                        ${isAnchor ? 'bg-yellow-300 text-black border-yellow-500 font-bold'
                                   : 'bg-white hover:bg-blue-50 border-neutral-100'}`}
                      style={{
                        width: cellWidth, minWidth: cellWidth, height: 32,
                        padding: 0,
                        writingMode: cellWidth < 18 ? 'vertical-rl' : undefined,
                        textOrientation: 'mixed' as any,
                        borderLeftWidth: isWeekStart ? 1 : 0,
                        borderLeftColor: '#e5e5e5',
                      }}
                    >
                      {cellWidth < 18 ? d.slice(5) : day}
                    </button>
                  );
                })}
              </div>

              {/* === Строки тикеров === */}
              {loadedTickers.map((sym, rowIdx) => {
                const row = matrix[sym] || [];
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
                      return (
                        <div
                          key={d}
                          onMouseEnter={ev => setHover({
                            x: ev.clientX, y: ev.clientY, sym, date: d,
                          })}
                          onMouseMove={ev => setHover(h => h ? { ...h, x: ev.clientX, y: ev.clientY } : null)}
                          onMouseLeave={() => setHover(null)}
                          className="border-r border-neutral-50 cursor-default"
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
                            fontSize: cellWidth >= 24 ? 10 : 0,
                            fontFamily: 'ui-monospace, monospace',
                          }}
                        >
                          {cellWidth >= 24 && v != null ? ((v * 100).toFixed(1)) : ''}
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
              left: Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 320),
              top: Math.min(hover.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200),
              maxWidth: 320,
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
                {anchorDate
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
            {!anchorDate && (
              <div className="text-neutral-400 mt-1 text-[10px]">
                клик на дату вверху → доходность от этого дня
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
