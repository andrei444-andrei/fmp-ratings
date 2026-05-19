'use client';

import { useEffect, useMemo, useState } from 'react';

type AiEvent = {
  date: string;
  title: string;
  description?: string;
  category?: string;
};
type GdeltArticle = {
  url: string;
  title: string;
  seendate: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

type PriceMap = Record<string, number>; // YYYY-MM-DD → close
type FmpPriceRow = { date: string; price: number };

const DEFAULT_PERIODS = '1,2,3,7,14,30,60,90,180';
const DEFAULT_ASSET = 'SPY';
const DEFAULT_MODEL = 'gpt-4o-mini';
const STORAGE_ASSET = 'me.asset';
const STORAGE_MODEL = 'me.model';
const STORAGE_PERIODS = 'me.periods';
const STORAGE_RETURN_MODE = 'me.returnMode';
const STORAGE_Y_FROM = 'me.yearFrom';
const STORAGE_Y_TO = 'me.yearTo';

const CATEGORY_COLORS: Record<string, string> = {
  geopolitics: '#dc2626',
  monetary:    '#2563eb',
  crisis:      '#9333ea',
  pandemic:    '#ea580c',
  policy:      '#0891b2',
  earnings:    '#16a34a',
  other:       '#525252',
};

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function currentYear(): number { return new Date().getUTCFullYear(); }
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstTradeOnOrAfter(dates: string[], target: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo < dates.length ? lo : -1;
}
function lastTradeOnOrBefore(dates: string[], target: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function parsePeriods(s: string): number[] {
  return Array.from(new Set(
    s.split(/[\s,;]+/)
     .map(t => t.trim())
     .filter(Boolean)
     .map(t => parseInt(t, 10))
     .filter(n => Number.isFinite(n) && n > 0 && n <= 3650)
  )).sort((a, b) => a - b);
}

function fmtPct(v: number | null, digits = 2): string {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + (v * 100).toFixed(digits) + '%';
}

function cellColor(r: number | null, clampPct: number): string {
  if (r == null || !isFinite(r)) return '#fafafa';
  const x = Math.max(-1, Math.min(1, r / (clampPct / 100)));
  const a = 0.08 + 0.8 * Math.abs(x);
  return x >= 0
    ? `rgba(22, 163, 74, ${a.toFixed(3)})`
    : `rgba(220, 38, 38, ${a.toFixed(3)})`;
}
function cellText(r: number | null, clampPct: number): string {
  if (r == null) return '#a3a3a3';
  return Math.abs(r / (clampPct / 100)) > 0.55 ? '#ffffff' : '#171717';
}

export default function MarketEventsPage() {
  // === Параметры ===
  const [query, setQuery] = useState('');
  const [yearFrom, setYearFrom] = useState(currentYear() - 5);
  const [yearTo, setYearTo] = useState(currentYear());
  const [asset, setAsset] = useState(DEFAULT_ASSET);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [periodsRaw, setPeriodsRaw] = useState(DEFAULT_PERIODS);
  const [returnMode, setReturnMode] = useState<'cumulative' | 'absolute'>('cumulative');
  const [limit, setLimit] = useState(25);
  const [maxPerYear, setMaxPerYear] = useState(100);
  const [clampPct, setClampPct] = useState(10);

  // === Данные ===
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [articles, setArticles] = useState<GdeltArticle[]>([]);
  const [gdeltQuery, setGdeltQuery] = useState('');
  const [prices, setPrices] = useState<PriceMap>({});
  const [pricesAsset, setPricesAsset] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showArticles, setShowArticles] = useState(false);

  useEffect(() => {
    try {
      const a = localStorage.getItem(STORAGE_ASSET); if (a) setAsset(a);
      const m = localStorage.getItem(STORAGE_MODEL); if (m) setModel(m);
      const p = localStorage.getItem(STORAGE_PERIODS); if (p) setPeriodsRaw(p);
      const r = localStorage.getItem(STORAGE_RETURN_MODE); if (r === 'absolute' || r === 'cumulative') setReturnMode(r);
      const yf = localStorage.getItem(STORAGE_Y_FROM); if (yf) setYearFrom(parseInt(yf, 10) || currentYear() - 5);
      const yt = localStorage.getItem(STORAGE_Y_TO); if (yt) setYearTo(parseInt(yt, 10) || currentYear());
    } catch {}
  }, []);

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_ASSET, asset);
      localStorage.setItem(STORAGE_MODEL, model);
      localStorage.setItem(STORAGE_PERIODS, periodsRaw);
      localStorage.setItem(STORAGE_RETURN_MODE, returnMode);
      localStorage.setItem(STORAGE_Y_FROM, String(yearFrom));
      localStorage.setItem(STORAGE_Y_TO, String(yearTo));
    } catch {}
  }

  const periods = useMemo(() => parsePeriods(periodsRaw), [periodsRaw]);

  async function run() {
    setLoading(true);
    setError(null);
    setStatus('Шаг 1/4 — AI формирует ключевые слова...');
    setEvents([]);
    setArticles([]);
    setGdeltQuery('');
    setPrices({});
    try {
      // === Шаг 1: AI → GDELT query ===
      const kwRes = await fetch('/api/ai/keywords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, model }),
      }).then(r => r.json());
      if (kwRes.error) throw new Error(`Ключевые слова: ${kwRes.error}`);
      const gq: string = kwRes.gdeltQuery;
      setGdeltQuery(gq);
      setStatus(`Шаг 2/4 — GDELT ищет статьи (${yearFrom}–${yearTo})...`);

      // === Шаг 2: GDELT ===
      const ndRes = await fetch('/api/news/gdelt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: gq, yearFrom, yearTo, maxPerYear }),
      }).then(r => r.json());
      if (ndRes.error) throw new Error(`GDELT: ${ndRes.error}`);
      const arts: GdeltArticle[] = ndRes.articles || [];
      setArticles(arts);
      if (!arts.length) {
        setStatus(`GDELT не нашёл статей. Уточните запрос или расширьте годы.`);
        setLoading(false);
        return;
      }
      setStatus(`Шаг 3/4 — AI группирует ${arts.length} статей в события...`);

      // === Шаг 3: AI → события ===
      const evRes = await fetch('/api/ai/cluster-events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, articles: arts, model, limit }),
      }).then(r => r.json());
      if (evRes.error) throw new Error(`Кластеризация: ${evRes.error}`);
      const evs: AiEvent[] = evRes.events || [];
      if (!evs.length) {
        setEvents([]);
        setStatus(`AI не нашёл подходящих событий среди ${arts.length} статей.`);
        setLoading(false);
        return;
      }
      // отрежем события вне диапазона лет (на всякий случай)
      const filtered = evs.filter(e => {
        const y = parseInt(e.date.slice(0, 4), 10);
        return y >= yearFrom && y <= yearTo;
      });
      setEvents(filtered);
      setStatus(`Шаг 4/4 — загружаю цены ${asset}...`);

      // === Шаг 4: цены актива одним запросом ===
      if (!filtered.length) {
        setStatus(`События за пределами диапазона лет.`);
        setLoading(false);
        return;
      }
      const minDate = filtered[0].date;
      const maxPeriod = Math.max(0, ...periods);
      const maxDate = addDays(filtered[filtered.length - 1].date, maxPeriod + 10);
      const today = todayIso();
      const to = maxDate > today ? today : maxDate;
      const from = addDays(minDate, -10);

      const priceRes = await fetch(
        `/api/fmp/historical-price-eod?symbol=${encodeURIComponent(asset)}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      ).then(r => r.json());
      if (priceRes?.error) throw new Error(`Цены: ${priceRes.error}`);
      const arr: FmpPriceRow[] = Array.isArray(priceRes) ? priceRes : (priceRes?.historical || []);
      if (!arr.length) throw new Error(`Нет данных по ${asset} в выбранном диапазоне`);

      const pm: PriceMap = {};
      for (const r of arr) {
        if (r && typeof r.date === 'string' && typeof r.price === 'number') pm[r.date] = r.price;
      }
      setPrices(pm);
      setPricesAsset(asset);
      setStatus(`✓ Готово: ${filtered.length} событий из ${arts.length} статей, ${Object.keys(pm).length} торговых дней по ${asset}.`);
      saveSettings();
    } catch (e: any) {
      setError(e.message);
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  const sortedTradingDates = useMemo(() => Object.keys(prices).sort(), [prices]);

  const rows = useMemo(() => {
    if (!events.length || !sortedTradingDates.length) return [];
    return events.map(ev => {
      const i0 = firstTradeOnOrAfter(sortedTradingDates, ev.date);
      if (i0 < 0) {
        return { event: ev, t0Date: null, t0Price: null, values: periods.map(() => null) };
      }
      const t0Date = sortedTradingDates[i0];
      const t0Price = prices[t0Date];
      let prevPrice = t0Price;

      const values = periods.map(k => {
        const target = addDays(ev.date, k);
        const idx = lastTradeOnOrBefore(sortedTradingDates, target);
        if (idx < i0) return null;
        const d = sortedTradingDates[idx];
        const p = prices[d];
        if (!p || !t0Price) return null;
        let v: number;
        if (returnMode === 'cumulative') {
          v = p / t0Price - 1;
        } else {
          v = prevPrice ? p / prevPrice - 1 : 0;
          prevPrice = p;
        }
        return v as number | null;
      });

      return { event: ev, t0Date, t0Price, values };
    });
  }, [events, prices, sortedTradingDates, periods, returnMode]);

  function downloadCsv() {
    if (!rows.length) return;
    const header = ['date', 'title', 'category', 't0_date', 't0_price',
                    ...periods.map(p => returnMode === 'cumulative' ? `T+${p}d` : `T+${p}d (abs)`)];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.join(',')];
    for (const r of rows) {
      const row = [
        r.event.date,
        r.event.title,
        r.event.category || '',
        r.t0Date || '',
        r.t0Price != null ? r.t0Price.toFixed(4) : '',
        ...r.values.map(v => v != null ? (v * 100).toFixed(4) : ''),
      ];
      lines.push(row.map(esc).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `market-events-${asset}-${todayIso()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  const minYear = 2015;
  const nowY = currentYear();

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-1">Анализ событий — реакция актива на исторические события</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Описание → AI генерирует ключевые слова → GDELT ищет статьи в диапазоне лет → AI группирует их в события → таблица доходностей актива.
        </p>

        <label className="flex flex-col mb-3">
          <span className="label">Описание событий для поиска</span>
          <textarea
            className="input w-full font-mono"
            rows={3}
            placeholder="Например: Крупные банкротства банков США; или: Дни, когда ФРС повышала ставку на 75 b.p.; или: Геополитические шоки на Ближнем Востоке."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Год от</span>
            <input type="number" className="input w-24" min={minYear} max={nowY}
                   value={yearFrom}
                   onChange={e => setYearFrom(Math.max(minYear, Math.min(nowY, parseInt(e.target.value) || minYear)))} />
          </label>
          <label className="flex flex-col">
            <span className="label">Год до</span>
            <input type="number" className="input w-24" min={minYear} max={nowY}
                   value={yearTo}
                   onChange={e => setYearTo(Math.max(minYear, Math.min(nowY, parseInt(e.target.value) || nowY)))} />
          </label>
          <label className="flex flex-col">
            <span className="label">Актив (default SPY)</span>
            <input type="text" className="input w-28 font-mono uppercase"
                   value={asset}
                   onChange={e => setAsset(e.target.value.toUpperCase().trim())} />
          </label>
          <label className="flex flex-col">
            <span className="label">Модель AI</span>
            <select className="input w-44" value={model} onChange={e => setModel(e.target.value)}>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-5">gpt-5</option>
              <option value="claude-3-5-sonnet-20241022">claude-3.5-sonnet</option>
              <option value="claude-opus-4-1">claude-opus-4.1</option>
              <option value="deepseek-chat">deepseek-chat</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Статей / год</span>
            <input type="number" className="input w-20" min={10} max={250}
                   value={maxPerYear}
                   onChange={e => setMaxPerYear(parseInt(e.target.value) || 100)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Макс. событий</span>
            <input type="number" className="input w-20" min={1} max={50}
                   value={limit}
                   onChange={e => setLimit(parseInt(e.target.value) || 25)} />
          </label>
          <button className="btn-primary" onClick={run} disabled={loading || !query.trim() || yearFrom > yearTo}>
            {loading ? 'Поиск...' : '▶ Найти события'}
          </button>
        </div>

        <div className="flex flex-wrap gap-3 items-end mt-3">
          <label className="flex flex-col">
            <span className="label">Периоды (календ. дней)</span>
            <input type="text" className="input w-56 font-mono"
                   value={periodsRaw}
                   onChange={e => setPeriodsRaw(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Тип доходности</span>
            <select className="input w-40" value={returnMode}
                    onChange={e => setReturnMode(e.target.value as any)}>
              <option value="cumulative">накопительная от T+0</option>
              <option value="absolute">периодная (между точками)</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Шкала ±%</span>
            <input type="number" className="input w-20" min={1} step={1}
                   value={clampPct}
                   onChange={e => setClampPct(parseFloat(e.target.value) || 10)} />
          </label>
          <button className="btn" onClick={downloadCsv} disabled={!rows.length}>Скачать CSV</button>
        </div>

        <div className="mt-3 text-xs space-y-1">
          {status && <div className="text-blue-600">{status}</div>}
          {error && <div className="text-red-600">Ошибка: {error}</div>}
          {gdeltQuery && (
            <div className="text-neutral-500">
              <span className="font-semibold">GDELT query:</span>{' '}
              <code className="bg-neutral-100 px-1 rounded">{gdeltQuery}</code>
            </div>
          )}
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card overflow-x-auto">
          <h3 className="font-semibold mb-2">
            Реакция <span className="font-mono">{pricesAsset || asset}</span> · {rows.length} событий
            <span className="text-xs font-normal text-neutral-500 ml-2">
              {returnMode === 'cumulative' ? 'накопительная от T+0' : 'между точками'}
            </span>
          </h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-100">
                <th className="text-left p-1.5 border whitespace-nowrap">Дата</th>
                <th className="text-left p-1.5 border">Событие</th>
                <th className="text-left p-1.5 border whitespace-nowrap">Кат.</th>
                <th className="text-right p-1.5 border whitespace-nowrap">T+0 цена</th>
                {periods.map(p => (
                  <th key={p} className="text-right p-1.5 border whitespace-nowrap">T+{p}d</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-neutral-50">
                  <td className="p-1.5 border font-mono whitespace-nowrap">{r.event.date}</td>
                  <td className="p-1.5 border">
                    <div className="font-semibold">{r.event.title}</div>
                    {r.event.description && (
                      <div className="text-neutral-500 text-[11px]">{r.event.description}</div>
                    )}
                  </td>
                  <td className="p-1.5 border whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full"
                            style={{ background: CATEGORY_COLORS[r.event.category || 'other'] || CATEGORY_COLORS.other }} />
                      <span className="text-neutral-700 text-[11px]">{r.event.category || 'other'}</span>
                    </span>
                  </td>
                  <td className="p-1.5 border text-right font-mono whitespace-nowrap text-neutral-600">
                    {r.t0Price != null ? r.t0Price.toFixed(2) : '—'}
                    {r.t0Date && r.t0Date !== r.event.date && (
                      <div className="text-[10px] text-neutral-400">{r.t0Date}</div>
                    )}
                  </td>
                  {r.values.map((v, j) => (
                    <td key={j}
                        className="p-1.5 border text-right font-mono whitespace-nowrap"
                        style={{ background: cellColor(v, clampPct), color: cellText(v, clampPct) }}>
                      {fmtPct(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-neutral-500 mt-2">
            T+0 = первый торговый день ≥ даты события. T+kd = последний торговый день ≤ event_date + k календарных дней.
            {returnMode === 'cumulative'
              ? ' Доходность считается к цене T+0.'
              : ' Доходность считается к предыдущей точке.'}
          </p>
        </section>
      )}

      {articles.length > 0 && (
        <section className="card">
          <button
            type="button"
            className="text-sm font-semibold text-neutral-700 hover:underline"
            onClick={() => setShowArticles(s => !s)}
          >
            {showArticles ? '▼' : '►'} Сырые статьи GDELT ({articles.length})
          </button>
          {showArticles && (
            <div className="mt-3 max-h-96 overflow-y-auto text-xs">
              <table className="w-full">
                <thead className="sticky top-0 bg-neutral-100">
                  <tr>
                    <th className="text-left p-1.5 border whitespace-nowrap">Дата</th>
                    <th className="text-left p-1.5 border">Заголовок</th>
                    <th className="text-left p-1.5 border whitespace-nowrap">Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((a, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="p-1.5 border font-mono whitespace-nowrap">{a.seendate}</td>
                      <td className="p-1.5 border">
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {a.title}
                        </a>
                      </td>
                      <td className="p-1.5 border whitespace-nowrap text-neutral-500">{a.domain}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
