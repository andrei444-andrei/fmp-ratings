'use client';

import { useEffect, useState } from 'react';

type Row = {
  id: number; year: number; date: string; symbol: string;
  newRating: string | null; previousRating: string | null;
  newGradeRaw: string | null; previousGradeRaw: string | null;
  gradingCompany: string | null; action: string | null;
  jumpSize: number | null; minJump: number | null;
};

export default function ResultsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [year, setYear] = useState<string>('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const url = '/api/read/filtered' + (year ? `?year=${year}` : '');
    const data = await fetch(url).then(r => r.json());
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function downloadCsv() {
    const headers = ['year','date','symbol','newRating','previousRating','newGradeRaw','previousGradeRaw','gradingCompany','action','jumpSize'];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = headers.join(',') + '\n' + rows.map(r => headers.map(h => esc((r as any)[h])).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rating_upgrades_pit.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  const byYear: Record<number, Row[]> = {};
  for (const r of rows) (byYear[r.year] = byYear[r.year] || []).push(r);
  const years = Object.keys(byYear).map(Number).sort((a,b)=>b-a);

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">Финальные апгрейды (point-in-time)</h2>
        <div className="flex gap-2 items-end">
          <label className="flex flex-col">
            <span className="label">Фильтр по году (опционально)</span>
            <input className="input" placeholder="напр. 2020" value={year} onChange={e => setYear(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={load}>Загрузить</button>
          <button className="btn" onClick={downloadCsv} disabled={!rows.length}>Скачать CSV</button>
          {loading && <span className="text-sm text-blue-600">Загрузка...</span>}
        </div>
        <p className="text-xs text-neutral-500 mt-2">Всего строк: {rows.length}</p>
      </section>

      {years.map(y => (
        <section key={y} className="card">
          <h3 className="font-semibold mb-2">{y} — {byYear[y].length} апгрейдов</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-100">
                  <th className="text-left p-2 border">Date</th>
                  <th className="text-left p-2 border">Symbol</th>
                  <th className="text-left p-2 border">New</th>
                  <th className="text-left p-2 border">Previous</th>
                  <th className="text-left p-2 border">Jump</th>
                  <th className="text-left p-2 border">Firm</th>
                </tr>
              </thead>
              <tbody>
                {byYear[y].slice(0, 100).map(r => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="p-2 border">{r.date}</td>
                    <td className="p-2 border font-mono">{r.symbol}</td>
                    <td className="p-2 border">{r.newRating} <span className="text-neutral-500 text-xs">({r.newGradeRaw})</span></td>
                    <td className="p-2 border">{r.previousRating} <span className="text-neutral-500 text-xs">({r.previousGradeRaw})</span></td>
                    <td className="p-2 border">+{r.jumpSize}</td>
                    <td className="p-2 border text-xs">{r.gradingCompany}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byYear[y].length > 100 && <p className="text-xs text-neutral-500 mt-1">Показаны первые 100 из {byYear[y].length}. CSV содержит все.</p>}
          </div>
        </section>
      ))}
    </main>
  );
}
