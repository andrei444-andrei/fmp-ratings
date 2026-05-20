'use client';

import { useEffect, useState } from 'react';

type Row = { id?: number; kind: 'sector' | 'country'; label: string; tickers: string; sortOrder?: number };

export default function TickerSetsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Row>({ kind: 'sector', label: '', tickers: '' });

  function load() {
    setLoading(true);
    fetch('/api/ticker-sets').then(r => r.json()).then(res => {
      if (res.error) setErr(res.error); else setRows(res.sets || []);
    }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function save(row: Row) {
    setErr(null);
    const res = await fetch('/api/ticker-sets', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row),
    }).then(r => r.json());
    if (res.error) setErr(res.error); else setRows(res.sets || []);
  }
  async function del(id?: number) {
    if (!id) return;
    if (!confirm('Удалить набор?')) return;
    const res = await fetch(`/api/ticker-sets?id=${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) setErr(res.error); else setRows(res.sets || []);
  }

  const sectors = rows.filter(r => r.kind === 'sector');
  const countries = rows.filter(r => r.kind === 'country');

  function Group({ title, list }: { title: string; list: Row[] }) {
    return (
      <section className="card">
        <h3 className="font-semibold mb-2">{title} <span className="text-xs text-neutral-500">({list.length})</span></h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="p-1">Название</th><th className="p-1">Тикеры (через запятую)</th><th className="p-1 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-1">
                  <input className="input w-full" defaultValue={r.label}
                    onBlur={e => { if (e.target.value !== r.label) save({ ...r, label: e.target.value }); }} />
                </td>
                <td className="p-1">
                  <input className="input w-full font-mono" defaultValue={r.tickers}
                    onBlur={e => { if (e.target.value !== r.tickers) save({ ...r, tickers: e.target.value }); }} />
                </td>
                <td className="p-1">
                  <button className="btn" onClick={() => del(r.id)}>Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-1">Наборы тикеров</h2>
        <p className="text-xs text-neutral-500 mb-2">
          Блоки для /heatmap: «Сектора США» и «Регионы мира». Изменения сразу видны на heatmap при перезагрузке.
        </p>
        {err && <div className="text-red-600 text-sm mb-2">Ошибка: {err}</div>}
        {loading && <div className="text-neutral-500 text-sm">Загрузка…</div>}
      </section>

      {!loading && <Group title="Сектора США" list={sectors} />}
      {!loading && <Group title="Регионы / страны" list={countries} />}

      <section className="card">
        <h3 className="font-semibold mb-2">Добавить набор</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col">
            <span className="label">Тип</span>
            <select className="input" value={draft.kind}
              onChange={e => setDraft(d => ({ ...d, kind: e.target.value as Row['kind'] }))}>
              <option value="sector">Сектор</option>
              <option value="country">Страна / регион</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Название</span>
            <input className="input" value={draft.label}
              onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
          </label>
          <label className="flex flex-col">
            <span className="label">Тикеры</span>
            <input className="input font-mono w-56" value={draft.tickers}
              placeholder="например FXI или FXI,MCHI"
              onChange={e => setDraft(d => ({ ...d, tickers: e.target.value }))} />
          </label>
          <button className="btn-primary" disabled={!draft.label.trim() || !draft.tickers.trim()}
            onClick={async () => { await save(draft); setDraft({ kind: draft.kind, label: '', tickers: '' }); }}>
            Добавить
          </button>
        </div>
      </section>
    </main>
  );
}
