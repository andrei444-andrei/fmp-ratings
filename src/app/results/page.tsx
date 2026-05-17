'use client';

import { useEffect, useState, useRef } from 'react';

type Event = {
  year: number; date: string; symbol: string; rank: number;
  newRating: string; previousRating: string;
  newRatingNum: number; previousRatingNum: number;
  newGradeRaw: string | null; previousGradeRaw: string | null;
  gradingCompany: string | null; action: string | null;
  jumpSize: number;
  consensusBefore: number | null; consensusFirmCount: number | null;
  belowConsensus: number;
};

const RATINGS = [
  { v: '', label: 'любой' },
  { v: '1', label: 'Strong Sell (1)' },
  { v: '2', label: 'Sell (2)' },
  { v: '3', label: 'Hold (3)' },
  { v: '4', label: 'Buy (4)' },
  { v: '5', label: 'Strong Buy (5)' },
];

export default function ResultsPage() {
  const [topN, setTopN] = useState(50);
  const [direction, setDirection] = useState<'upgrade'|'downgrade'|'any'>('upgrade');
  const [minJump, setMinJump] = useState(2);
  const [fromRating, setFromRating] = useState('');
  const [toRating, setToRating] = useState('');
  const [consensus, setConsensus] = useState<'any'|'below'|'above'>('any');
  const [year, setYear] = useState('');

  const [events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<{count:number; consFromFmp:number; consMissing:number} | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  function buildUrl() {
    const params = new URLSearchParams();
    params.set('topN', String(topN));
    params.set('direction', direction);
    params.set('minJump', String(minJump));
    if (fromRating) params.set('fromRating', fromRating);
    if (toRating) params.set('toRating', toRating);
    params.set('consensus', consensus);
    if (year) params.set('year', year);
    return `/api/query/events?${params.toString()}`;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetch(buildUrl()).then(r => r.json());
      if (data.error) {
        setError(data.error);
        setEvents([]);
        setStats(null);
      } else {
        setEvents(data.events || []);
        setStats(data.stats || null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // дебаунс: после изменения фильтра подождать 300мс и перезагрузить
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(load, 300) as unknown as number;
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topN, direction, minJump, fromRating, toRating, consensus, year]);

  function downloadCsv() {
    const headers = ['year','date','symbol','rank','newRating','previousRating','newGradeRaw','previousGradeRaw','gradingCompany','jumpSize','consensusBefore','consensusFirmCount','belowConsensus'];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = headers.join(',') + '\n' + events.map(e => headers.map(h => esc((e as any)[h])).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `events_${direction}_jump${minJump}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  // группировка по году для отображения
  const byYear: Record<number, Event[]> = {};
  for (const e of events) (byYear[e.year] = byYear[e.year] || []).push(e);
  const years = Object.keys(byYear).map(Number).sort((a,b)=>b-a);

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-3">Фильтры</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex flex-col">
            <span className="label">Top-N компаний</span>
            <input type="number" className="input w-24" value={topN} min={1} max={500}
                   onChange={e => setTopN(parseInt(e.target.value) || 50)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Направление</span>
            <select className="input" value={direction} onChange={e => setDirection(e.target.value as any)}>
              <option value="upgrade">Upgrade</option>
              <option value="downgrade">Downgrade</option>
              <option value="any">Любое</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Мин. скачок (уровней)</span>
            <select className="input" value={minJump} onChange={e => setMinJump(parseInt(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Из рейтинга</span>
            <select className="input" value={fromRating} onChange={e => setFromRating(e.target.value)}>
              {RATINGS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">В рейтинг</span>
            <select className="input" value={toRating} onChange={e => setToRating(e.target.value)}>
              {RATINGS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Консенсус</span>
            <select className="input" value={consensus} onChange={e => setConsensus(e.target.value as any)}>
              <option value="any">Любой</option>
              <option value="below">Новый ниже консенсуса</option>
              <option value="above">Новый выше консенсуса</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Год (опционально)</span>
            <input type="text" className="input w-24" placeholder="напр. 2020"
                   value={year} onChange={e => setYear(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex gap-2 items-center flex-wrap">
          <button className="btn" onClick={load} disabled={loading}>Обновить</button>
          <button className="btn-primary" onClick={downloadCsv} disabled={!events.length}>Скачать CSV ({events.length})</button>
          {loading && <span className="text-sm text-blue-600">Загрузка...</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          {stats && !loading && (
            <span className="text-sm text-neutral-600">
              {stats.count} событий · консенсус из FMP: {stats.consFromFmp}, без консенсуса: {stats.consMissing}
            </span>
          )}
        </div>
      </section>

      {years.map(y => (
        <section key={y} className="card">
          <h3 className="font-semibold mb-2">{y} — {byYear[y].length}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-100">
                  <th className="text-left p-2 border">Date</th>
                  <th className="text-left p-2 border">Symbol</th>
                  <th className="text-left p-2 border">Rank</th>
                  <th className="text-left p-2 border">New</th>
                  <th className="text-left p-2 border">Previous</th>
                  <th className="text-left p-2 border">Jump</th>
                  <th className="text-left p-2 border">Consensus</th>
                  <th className="text-left p-2 border">vs Cons.</th>
                  <th className="text-left p-2 border">Firm</th>
                </tr>
              </thead>
              <tbody>
                {byYear[y].slice(0, 200).map((r, i) => (
                  <tr key={`${r.symbol}-${r.date}-${i}`} className="hover:bg-neutral-50">
                    <td className="p-2 border">{r.date}</td>
                    <td className="p-2 border font-mono">{r.symbol}</td>
                    <td className="p-2 border">{r.rank}</td>
                    <td className="p-2 border">{r.newRating} <span className="text-neutral-500 text-xs">({r.newGradeRaw})</span></td>
                    <td className="p-2 border">{r.previousRating} <span className="text-neutral-500 text-xs">({r.previousGradeRaw})</span></td>
                    <td className="p-2 border">{r.jumpSize > 0 ? '+' : ''}{r.jumpSize}</td>
                    <td className="p-2 border">{r.consensusBefore != null ? r.consensusBefore.toFixed(2) : '—'} <span className="text-neutral-500 text-xs">(n={r.consensusFirmCount ?? 0})</span></td>
                    <td className="p-2 border">{r.consensusBefore == null ? '—' : (r.belowConsensus ? '↓ below' : '↑ above')}</td>
                    <td className="p-2 border text-xs">{r.gradingCompany}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byYear[y].length > 200 && <p className="text-xs text-neutral-500 mt-1">Показаны первые 200 из {byYear[y].length} (CSV содержит все).</p>}
          </div>
        </section>
      ))}
    </main>
  );
}
