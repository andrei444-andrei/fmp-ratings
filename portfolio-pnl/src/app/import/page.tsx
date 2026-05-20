'use client';

import { useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { ASSET_CLASSES, ASSET_CLASS_LABEL, type AssetClass, type ParsedHolding } from '@/lib/types';
import { fmtMoney } from '@/lib/format';

type Tab = 'csv' | 'manual' | 'ai';
type Row = ParsedHolding & { source: 'csv' | 'manual' | 'ai' };

function currentQuarter(): string {
  const now = new Date();
  return `${now.getFullYear()}Q${Math.floor(now.getMonth() / 3) + 1}`;
}

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>('csv');
  const [quarter, setQuarter] = useState(currentQuarter());
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // CSV
  const [csvText, setCsvText] = useState('');
  const [csvClass, setCsvClass] = useState<AssetClass>('public');

  // AI
  const [aiText, setAiText] = useState('');

  // Manual
  const [m, setM] = useState<ParsedHolding>({ assetClass: 'public', name: '', value: 0 });

  function addRows(newRows: ParsedHolding[], source: Row['source']) {
    setRows((prev) => [...prev, ...newRows.map((r) => ({ ...r, source }))]);
  }

  async function parseCsv() {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: csvText, assetClass: csvClass, useAiForUnmapped: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      addRows(json.holdings, 'csv');
      setNotice({ kind: 'ok', text: `Распознано: ${json.stats.mapped} по колонкам${json.stats.aiRecovered ? `, +${json.stats.aiRecovered} через AI` : ''}, не разобрано: ${json.stats.unmapped}.` });
      setCsvText('');
    } catch (e) {
      setNotice({ kind: 'error', text: String(e) });
    } finally { setBusy(false); }
  }

  async function parseAi() {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/ai/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: aiText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (!json.holdings.length) throw new Error('AI не нашёл позиций в тексте');
      addRows(json.holdings, 'ai');
      setNotice({ kind: 'ok', text: `AI распознал ${json.count} позиций.` });
      setAiText('');
    } catch (e) {
      setNotice({ kind: 'error', text: String(e) });
    } finally { setBusy(false); }
  }

  function addManual() {
    if (!m.name.trim() || !Number.isFinite(m.value)) {
      setNotice({ kind: 'error', text: 'Заполните название и стоимость.' });
      return;
    }
    addRows([{ ...m }], 'manual');
    setM({ assetClass: m.assetClass, name: '', value: 0 });
    setNotice(null);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!rows.length) return;
    if (!/^\d{4}Q[1-4]$/.test(quarter)) {
      setNotice({ kind: 'error', text: 'Квартал в формате YYYYQn, например 2026Q1.' });
      return;
    }
    setBusy(true); setNotice(null);
    try {
      // Группируем по источнику, чтобы корректно проставить source в БД.
      const bySource: Record<string, Row[]> = {};
      for (const r of rows) (bySource[r.source] ||= []).push(r);
      let inserted = 0;
      for (const [source, group] of Object.entries(bySource)) {
        const res = await fetch('/api/holdings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quarter, source, holdings: group }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        inserted += json.inserted;
      }
      setRows([]);
      setNotice({ kind: 'ok', text: `Сохранено ${inserted} позиций в ${quarter}. Откройте Overview.` });
    } catch (e) {
      setNotice({ kind: 'error', text: String(e) });
    } finally { setBusy(false); }
  }

  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);

  return (
    <div className="app">
      <TopBar active="import" />
      <div className="container">
        <h2 className="section-title">Ввод данных</h2>
        <p className="section-sub">Загрузите CSV брокера, введите вручную или вставьте «как есть» — AI разложит по позициям. Затем проверьте и сохраните в выбранный квартал.</p>

        <div className="field" style={{ maxWidth: 220 }}>
          <label>Квартал</label>
          <input className="input" value={quarter} onChange={(e) => setQuarter(e.target.value.toUpperCase())} placeholder="2026Q1" />
        </div>

        <div className="tabs">
          <div className={`tab ${tab === 'csv' ? 'on' : ''}`} onClick={() => setTab('csv')}>CSV брокера</div>
          <div className={`tab ${tab === 'manual' ? 'on' : ''}`} onClick={() => setTab('manual')}>Вручную</div>
          <div className={`tab ${tab === 'ai' ? 'on' : ''}`} onClick={() => setTab('ai')}>AI · как есть</div>
        </div>

        {notice && <div className={`notice notice-${notice.kind}`}>{notice.text}</div>}

        {tab === 'csv' && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <div className="field" style={{ margin: 0, minWidth: 200 }}>
                <label>Класс актива (для всех строк)</label>
                <select className="select" value={csvClass} onChange={(e) => setCsvClass(e.target.value as AssetClass)}>
                  {ASSET_CLASSES.map((ac) => <option key={ac} value={ac}>{ASSET_CLASS_LABEL[ac]}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>…или файл .csv</label>
                <input type="file" accept=".csv,text/csv" onChange={onFile} />
              </div>
            </div>
            <textarea className="textarea" value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={'Symbol,Description,Quantity,Market Value,Cost Basis\nAAPL,Apple Inc,100,18500,12000\n...'} />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={parseCsv} disabled={busy || !csvText.trim()}>{busy ? 'Парсинг…' : 'Распарсить'}</button>
              <span className="muted" style={{ fontSize: 12 }}>Строки, не легшие по колонкам, отправятся в AI автоматически.</span>
            </div>
          </div>
        )}

        {tab === 'ai' && (
          <div className="card" style={{ marginBottom: 16 }}>
            <textarea className="textarea" value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder={'Вставьте что угодно: выписку, заметки, сообщение из чата…\n\nНапример:\n«квартира в Дубае ~1.2М, на ИБ счёте акций примерно на 9 миллионов, биток 12 штук, кэш в ENBD около 140к»'} />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={parseAi} disabled={busy || !aiText.trim()}>{busy ? 'AI распознаёт…' : 'Распознать через AI'}</button>
              <span className="muted" style={{ fontSize: 12 }}>Через aimlapi.com. Проверьте классы и суммы перед сохранением.</span>
            </div>
          </div>
        )}

        {tab === 'manual' && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="btn-row">
              <div className="field" style={{ margin: 0, minWidth: 160 }}>
                <label>Класс</label>
                <select className="select" value={m.assetClass} onChange={(e) => setM({ ...m, assetClass: e.target.value as AssetClass })}>
                  {ASSET_CLASSES.map((ac) => <option key={ac} value={ac}>{ASSET_CLASS_LABEL[ac]}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                <label>Название</label>
                <input className="input" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="Apple Inc / Квартира Dubai" />
              </div>
              <div className="field" style={{ margin: 0, width: 110 }}>
                <label>Тикер</label>
                <input className="input" value={m.symbol ?? ''} onChange={(e) => setM({ ...m, symbol: e.target.value })} placeholder="AAPL" />
              </div>
              <div className="field" style={{ margin: 0, width: 140 }}>
                <label>Стоимость $</label>
                <input className="input num" type="number" value={m.value || ''} onChange={(e) => setM({ ...m, value: parseFloat(e.target.value) })} />
              </div>
              <div className="field" style={{ margin: 0, width: 140 }}>
                <label>Себестоимость $</label>
                <input className="input num" type="number" value={m.costBasis ?? ''} onChange={(e) => setM({ ...m, costBasis: e.target.value ? parseFloat(e.target.value) : null })} />
              </div>
            </div>
            <button className="btn" onClick={addManual}>+ Добавить в список</button>
          </div>
        )}

        {/* PREVIEW */}
        {rows.length > 0 && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>Предпросмотр · {rows.length} позиций · {fmtMoney(total, { compact: true })}</div>
              <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Сохранение…' : `Сохранить в ${quarter}`}</button>
            </div>
            <table className="table">
              <thead>
                <tr><th>Класс</th><th>Название</th><th>Тикер</th><th className="num">Кол-во</th><th className="num">Стоимость</th><th className="num">Себест.</th><th>Ист.</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select className="select" style={{ padding: '2px 4px', fontSize: 12 }} value={r.assetClass} onChange={(e) => updateRow(i, { assetClass: e.target.value as AssetClass })}>
                        {ASSET_CLASSES.map((ac) => <option key={ac} value={ac}>{ASSET_CLASS_LABEL[ac]}</option>)}
                      </select>
                    </td>
                    <td>{r.name}{r.note ? <div className="muted" style={{ fontSize: 10 }}>{r.note}</div> : null}</td>
                    <td>{r.symbol || '—'}</td>
                    <td className="num">{r.quantity ?? '—'}</td>
                    <td className="num">
                      <input className="input num" style={{ padding: '2px 6px', width: 100, fontSize: 12 }} type="number" value={r.value} onChange={(e) => updateRow(i, { value: parseFloat(e.target.value) })} />
                    </td>
                    <td className="num">{r.costBasis ?? '—'}</td>
                    <td><span className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>{r.source}</span></td>
                    <td><span className="icon-btn" onClick={() => removeRow(i)} title="Удалить">✕</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
