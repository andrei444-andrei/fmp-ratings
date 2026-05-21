'use client';

import { useEffect, useState } from 'react';
import { INVESTOR_TYPE_LABEL, type Investor, type InvestorType } from '@/lib/superinvestor/types';

const TYPES: InvestorType[] = ['value', 'activist', 'macro', 'concentrated', 'quant'];

export default function AddInvestor({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<Investor[]>([]);
  const [name, setName] = useState('');
  const [fund, setFund] = useState('');
  const [cik, setCik] = useState('');
  const [type, setType] = useState<InvestorType>('value');
  const [blurb, setBlurb] = useState('');
  const [matches, setMatches] = useState<{ cik: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadCustom() {
    try {
      const res = await fetch('/api/superinvestor/investors').then(r => r.json());
      setCustom(res.custom || []);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadCustom(); }, []);

  async function search() {
    if (name.trim().length < 2) return;
    setSearching(true); setErr(null); setMatches([]);
    try {
      const res = await fetch(`/api/superinvestor/search?q=${encodeURIComponent(name.trim())}`).then(r => r.json());
      if (res.error) setErr(res.error);
      else setMatches(res.matches || []);
    } catch (e: any) { setErr(e.message); }
    finally { setSearching(false); }
  }

  async function submit() {
    if (!name.trim() || !cik.trim()) { setErr('Нужны имя и CIK'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/superinvestor/investors', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, fund, cik, type, blurb }),
      }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      setCustom(res.custom || []);
      setName(''); setFund(''); setCik(''); setBlurb(''); setMatches([]);
      onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function del(slug: string) {
    try {
      const res = await fetch(`/api/superinvestor/investors?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      setCustom(res.custom || []);
      onChanged();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="si-add">
      <button className="hm-ghost" onClick={() => setOpen(o => !o)}>
        {open ? '× Свернуть' : '+ Добавить инвестора'}
      </button>
      {custom.length > 0 && (
        <span className="si-chiplist" style={{ display: 'inline-flex', marginLeft: 10, marginTop: 0, verticalAlign: 'middle' }}>
          {custom.map(c => (
            <span key={c.slug} className="si-chip">
              <a href={`/superinvestor/${c.slug}`}>{c.name}</a>
              <button title="Удалить" onClick={() => del(c.slug)}>×</button>
            </span>
          ))}
        </span>
      )}

      {open && (
        <div className="si-panel" style={{ marginTop: 10 }}>
          <div className="si-panel-h">Новый 13F-филер <span className="c">найдите CIK по имени или введите вручную (SEC EDGAR / 13f.info)</span></div>
          <div className="si-form">
            <div className="si-field" style={{ gridColumn: 'span 2' }}>
              <label>Имя</label>
              <input className="si-input" value={name} placeholder="напр. Warren Buffett"
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') search(); }} />
            </div>
            <div className="si-field">
              <label>Фонд</label>
              <input className="si-input" value={fund} placeholder="напр. Berkshire Hathaway" onChange={e => setFund(e.target.value)} />
            </div>
            <div className="si-field">
              <label>CIK</label>
              <input className="si-input" value={cik} placeholder="0001067983" onChange={e => setCik(e.target.value)} />
            </div>
            <div className="si-field">
              <label>Тип</label>
              <select className="si-select" value={type} onChange={e => setType(e.target.value as InvestorType)}>
                {TYPES.map(t => <option key={t} value={t}>{INVESTOR_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="si-field" style={{ display: 'flex', gap: 6 }}>
              <button className="hm-ghost" onClick={search} disabled={searching || name.trim().length < 2}>
                {searching ? '…' : '🔍 Найти CIK'}
              </button>
              <button className="hm-ghost primary" onClick={submit} disabled={busy || !name.trim() || !cik.trim()}>
                {busy ? '…' : 'Добавить'}
              </button>
            </div>
          </div>

          {err && <div className="si-err" style={{ fontSize: 12, marginTop: 8 }}>{err}</div>}

          {matches.length > 0 && (
            <div className="si-matches">
              {matches.map(m => (
                <button key={m.cik} className="si-match" onClick={() => { setName(m.name); setCik(m.cik); setMatches([]); }}>
                  <span>{m.name}</span><span className="cik">{m.cik}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
