'use client';

import { useState } from 'react';
import type { QcProject, QcBacktestSummary } from '@/lib/quantconnect/types';

// Добавление алгоритма: поиск по проектам QuantConnect (выпадающий список) ИЛИ ввод вручную.
export default function AddAlgorithm({ disabled, onAdded }: { disabled?: boolean; onAdded: () => void }) {
  const [mode, setMode] = useState<'search' | 'manual'>('search');

  // общие поля
  const [projectId, setProjectId] = useState('');
  const [backtestId, setBacktestId] = useState('');
  const [name, setName] = useState('');
  const [benchmark, setBenchmark] = useState('');

  // поиск
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<QcProject[]>([]);
  const [backtests, setBacktests] = useState<QcBacktestSummary[]>([]);
  const [searching, setSearching] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function searchProjects() {
    setSearching(true); setErr(null); setProjects([]); setBacktests([]);
    try {
      const res = await fetch(`/api/quantconnect/projects?q=${encodeURIComponent(query.trim())}`).then(r => r.json());
      if (res.error) setErr(res.error);
      else setProjects(res.projects || []);
    } catch (e: any) { setErr(e.message); }
    finally { setSearching(false); }
  }

  async function pickProject(p: QcProject) {
    setProjectId(String(p.projectId));
    setName(p.name || `Проект ${p.projectId}`);
    setProjects([]);
    setBacktests([]);
    setBacktestId('');
    // подтягиваем бектесты проекта для выбора
    try {
      const res = await fetch(`/api/quantconnect/backtests?projectId=${p.projectId}`).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      const list: QcBacktestSummary[] = res.backtests || [];
      setBacktests(list);
      const latest = list.find(b => b.completed) || list[0];
      if (latest) setBacktestId(latest.backtestId);
    } catch (e: any) { setErr(e.message); }
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/quantconnect/algorithms', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, backtestId: backtestId || null, name, benchmark: benchmark || null }),
      }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      // сброс
      setProjectId(''); setBacktestId(''); setName(''); setBenchmark('');
      setQuery(''); setProjects([]); setBacktests([]);
      onAdded();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const canSubmit = /^\d+$/.test(projectId.trim()) && !busy;

  return (
    <div className="qc-panel">
      <div className="qc-panel-h">
        Добавить алгоритм
        <span className="c">поиск по проектам QuantConnect или ввод ID вручную</span>
        <span className="qc-spacer" />
        <span className="qc-seg">
          <button className={mode === 'search' ? 'on' : ''} onClick={() => setMode('search')}>Поиск</button>
          <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>Вручную</button>
        </span>
      </div>

      {mode === 'search' && (
        <div className="qc-form" style={{ marginBottom: 8 }}>
          <div className="qc-field" style={{ gridColumn: 'span 2' }}>
            <label>Название проекта</label>
            <input className="qc-input" value={query} placeholder="напр. EMA Cross" disabled={disabled}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchProjects(); }} />
          </div>
          <div className="qc-field">
            <button className="qc-btn" onClick={searchProjects} disabled={disabled || searching}>
              {searching ? '…' : '🔍 Найти проект'}
            </button>
          </div>
        </div>
      )}

      {mode === 'search' && projects.length > 0 && (
        <div className="qc-matches">
          {projects.map(p => (
            <button key={p.projectId} className="qc-match" onClick={() => pickProject(p)}>
              <span>{p.name || `Проект ${p.projectId}`}</span>
              <span className="meta">#{p.projectId}{p.language ? ` · ${p.language}` : ''}</span>
            </button>
          ))}
        </div>
      )}

      {/* выбранные параметры (общие для обоих режимов) */}
      <div className="qc-form" style={{ marginTop: projects.length ? 12 : 0 }}>
        <div className="qc-field">
          <label>Project ID</label>
          <input className="qc-input" value={projectId} placeholder="123456" disabled={disabled}
            onChange={e => setProjectId(e.target.value)} />
        </div>
        <div className="qc-field" style={{ gridColumn: 'span 2' }}>
          <label>Backtest {mode === 'search' && backtests.length ? '' : '(опц.)'}</label>
          {mode === 'search' && backtests.length ? (
            <select className="qc-select" value={backtestId} onChange={e => setBacktestId(e.target.value)} disabled={disabled}>
              {backtests.map(b => (
                <option key={b.backtestId} value={b.backtestId}>
                  {b.name || b.backtestId.slice(0, 8)}{b.completed ? '' : ` · ${b.status || 'не завершён'}`}
                </option>
              ))}
            </select>
          ) : (
            <input className="qc-input" value={backtestId} placeholder="пусто = последний завершённый" disabled={disabled}
              onChange={e => setBacktestId(e.target.value)} />
          )}
        </div>
        <div className="qc-field">
          <label>Метка</label>
          <input className="qc-input" value={name} placeholder="имя алгоритма" disabled={disabled}
            onChange={e => setName(e.target.value)} />
        </div>
        <div className="qc-field">
          <button className="qc-btn primary" onClick={submit} disabled={disabled || !canSubmit}>
            {busy ? '…' : '+ Добавить в портфель'}
          </button>
        </div>
      </div>

      {err && <div className="qc-err" style={{ fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
