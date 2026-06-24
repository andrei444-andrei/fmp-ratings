'use client';

import { useState } from 'react';
import type { AlgoColumn, QcProject, QcBacktestSummary } from '@/lib/quantconnect/types';

// Ad-hoc сравнение: ввёл Project ID + выбрал бектест из QuantConnect → колонка в
// матрицу «Сравнение по годам», без добавления в портфель/БД.
export default function PreviewCompare({
  previews, onAdd, onRemove, disabled,
}: { previews: AlgoColumn[]; onAdd: (c: AlgoColumn) => void; onRemove: (id: number) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<QcProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [backtests, setBacktests] = useState<QcBacktestSummary[]>([]);
  const [btLoading, setBtLoading] = useState(false);
  const [backtestId, setBacktestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function searchProjects() {
    setSearching(true); setErr(null); setProjects([]);
    try {
      const r = await fetch(`/api/quantconnect/projects?q=${encodeURIComponent(query.trim())}`).then(x => x.json());
      if (r.error) setErr(r.error); else setProjects(r.projects || []);
    } catch (e: any) { setErr(e.message); } finally { setSearching(false); }
  }
  async function loadBacktests(pid: string) {
    if (!/^\d+$/.test(pid)) { setBacktests([]); return; }
    setBtLoading(true);
    try { const r = await fetch(`/api/quantconnect/backtests?projectId=${pid}`).then(x => x.json()); setBacktests(r.error ? [] : (r.backtests || [])); }
    catch { setBacktests([]); } finally { setBtLoading(false); }
  }
  function pickProject(p: QcProject) { setProjectId(String(p.projectId)); setProjects([]); setBacktestId(''); loadBacktests(String(p.projectId)); }

  async function add() {
    if (!/^\d+$/.test(projectId)) { setErr('Project ID — число'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/quantconnect/preview?projectId=${projectId}${backtestId ? `&backtestId=${backtestId}` : ''}`).then(x => x.json());
      if (r.error) { setErr(r.error); return; }
      if (r.column?.error) { setErr(r.column.error); return; }
      onAdd(r.column);
      setBacktestId('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="qc-panel">
      <div className="qc-panel-h">Сравнить бектест из QuantConnect <span className="c">ad-hoc, без добавления в портфель</span>
        <span className="qc-spacer" />
        <button className="qc-btn" onClick={() => setOpen(o => !o)} disabled={disabled}>{open ? 'Свернуть' : '+ Бектест в сравнение'}</button>
      </div>

      {previews.length > 0 && (
        <div className="qc-chiplist" style={{ marginBottom: open ? 12 : 0 }}>
          {previews.map(p => (
            <span key={p.id} className="qc-chip">
              {p.name}{p.error ? ' ⚠' : ''}<span className="pid">#{p.projectId}</span>
              <button onClick={() => onRemove(p.id)} title="Убрать из сравнения">×</button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="qc-form" style={{ marginTop: 4 }}>
          <div className="qc-field" style={{ gridColumn: '1 / -1' }}>
            <label>Найти проект по имени</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="qc-input" value={query} placeholder="имя проекта…" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') searchProjects(); }} />
              <button className="qc-btn" onClick={searchProjects} disabled={searching}>{searching ? '…' : '🔍'}</button>
            </div>
            {projects.length > 0 && (
              <div className="qc-matches" style={{ maxHeight: 160 }}>
                {projects.map(p => (
                  <button key={p.projectId} className="qc-match" onClick={() => pickProject(p)}>
                    <span>{p.name || `Проект ${p.projectId}`}</span><span className="meta">#{p.projectId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="qc-field">
            <label>Project ID</label>
            <input className="qc-input" value={projectId} placeholder="32825394"
              onChange={e => setProjectId(e.target.value)} onBlur={e => loadBacktests(e.target.value.trim())} />
          </div>
          <div className="qc-field" style={{ gridColumn: 'span 2' }}>
            <label>Бектест {btLoading ? '· загрузка…' : ''}</label>
            <select className="qc-select" value={backtestId} onChange={e => setBacktestId(e.target.value)}>
              <option value="">последний завершённый</option>
              {backtests.map(b => (
                <option key={b.backtestId} value={b.backtestId}>{b.name || b.backtestId.slice(0, 8)}{b.completed ? '' : ` · ${b.status || 'не завершён'}`}</option>
              ))}
            </select>
          </div>
          <div className="qc-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="qc-btn primary" onClick={add} disabled={busy || !/^\d+$/.test(projectId)}>{busy ? '…' : 'Добавить в сравнение'}</button>
          </div>
        </div>
      )}
      {err && <div className="qc-errbox">⚠ {err}</div>}
    </div>
  );
}
