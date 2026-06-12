'use client';

import { useEffect, useState } from 'react';
import MarkdownEditor from './MarkdownEditor';
import { QC_STATUSES, QC_STATUS_LABEL, type QcAlgoStatus, type QcProject, type QcBacktestSummary } from '@/lib/quantconnect/types';

// Кнопка «＋ Добавить стратегию» → модалка: поиск по проектам QuantConnect ИЛИ ввод вручную,
// плюс описание и статус.
export default function AddAlgorithm({ disabled, onAdded }: { disabled?: boolean; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'search' | 'manual'>('search');

  const [projectId, setProjectId] = useState('');
  const [backtestId, setBacktestId] = useState('');
  const [name, setName] = useState('');
  const [benchmark, setBenchmark] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<QcAlgoStatus>('active');

  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<QcProject[]>([]);
  const [backtests, setBacktests] = useState<QcBacktestSummary[]>([]);
  const [searching, setSearching] = useState(false);

  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    if (!/^\d+$/.test(projectId.trim())) { setErr('Сначала укажите Project ID'); return; }
    setGen(true); setErr(null);
    try {
      const res = await fetch('/api/quantconnect/describe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: projectId.trim() }),
      }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      setDescription(res.description || '');
    } catch (e: any) { setErr(e.message); }
    finally { setGen(false); }
  }

  function reset() {
    setMode('search');
    setProjectId(''); setBacktestId(''); setName(''); setBenchmark(''); setDescription(''); setStatus('active');
    setQuery(''); setProjects([]); setBacktests([]); setErr(null);
  }
  function close() { setOpen(false); reset(); }

  // Esc закрывает модалку.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
        body: JSON.stringify({ projectId, backtestId: backtestId || null, name, benchmark: benchmark || null, description: description || null, status }),
      }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      onAdded();
      close();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const canSubmit = /^\d+$/.test(projectId.trim()) && !busy;

  return (
    <>
      <button className="qc-btn primary" onClick={() => setOpen(true)} disabled={disabled}
        title={disabled ? 'Сначала введите креды QuantConnect в админке' : undefined}>
        ＋ Добавить стратегию
      </button>

      {open && (
        <div className="qc-modal-overlay" onMouseDown={close}>
          <div className="qc-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="qc-modal-h">
              Добавить стратегию
              <span className="qc-spacer" />
              <span className="qc-seg">
                <button className={mode === 'search' ? 'on' : ''} onClick={() => setMode('search')}>Поиск</button>
                <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>Вручную</button>
              </span>
              <button className="qc-modal-x" onClick={close} aria-label="Закрыть">×</button>
            </div>

            <div className="qc-modal-body">
              {mode === 'search' && (
                <>
                  <div className="qc-form" style={{ marginBottom: 8 }}>
                    <div className="qc-field" style={{ gridColumn: 'span 2' }}>
                      <label>Название проекта</label>
                      <input className="qc-input" value={query} placeholder="напр. EMA Cross" autoFocus
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') searchProjects(); }} />
                    </div>
                    <div className="qc-field">
                      <button className="qc-btn" onClick={searchProjects} disabled={searching}>
                        {searching ? '…' : '🔍 Найти проект'}
                      </button>
                    </div>
                  </div>
                  {projects.length > 0 && (
                    <div className="qc-matches">
                      {projects.map(p => (
                        <button key={p.projectId} className="qc-match" onClick={() => pickProject(p)}>
                          <span>{p.name || `Проект ${p.projectId}`}</span>
                          <span className="meta">#{p.projectId}{p.language ? ` · ${p.language}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="qc-form" style={{ marginTop: projects.length ? 12 : 0 }}>
                <div className="qc-field">
                  <label>Project ID</label>
                  <input className="qc-input" value={projectId} placeholder="123456"
                    onChange={e => setProjectId(e.target.value)} />
                </div>
                <div className="qc-field" style={{ gridColumn: 'span 2' }}>
                  <label>Backtest {mode === 'search' && backtests.length ? '' : '(опц.)'}</label>
                  {mode === 'search' && backtests.length ? (
                    <select className="qc-select" value={backtestId} onChange={e => setBacktestId(e.target.value)}>
                      {backtests.map(b => (
                        <option key={b.backtestId} value={b.backtestId}>
                          {b.name || b.backtestId.slice(0, 8)}{b.completed ? '' : ` · ${b.status || 'не завершён'}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="qc-input" value={backtestId} placeholder="пусто = последний завершённый"
                      onChange={e => setBacktestId(e.target.value)} />
                  )}
                </div>
                <div className="qc-field">
                  <label>Метка</label>
                  <input className="qc-input" value={name} placeholder="имя стратегии"
                    onChange={e => setName(e.target.value)} />
                </div>
                <div className="qc-field">
                  <label>Статус</label>
                  <select className="qc-select" value={status} onChange={e => setStatus(e.target.value as QcAlgoStatus)}>
                    {QC_STATUSES.map(s => <option key={s} value={s}>{QC_STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="qc-field" style={{ gridColumn: '1 / -1' }}>
                  <label>Описание (опц.)</label>
                  <MarkdownEditor value={description} onChange={setDescription} onGenerate={generate} generating={gen}
                    rows={4} placeholder="что делает стратегия, плечо, инструменты… (Markdown)" />
                </div>
              </div>

              {err && <div className="qc-err" style={{ fontSize: 12, marginTop: 8 }}>{err}</div>}
            </div>

            <div className="qc-modal-foot">
              <button className="qc-btn" onClick={close}>Отмена</button>
              <button className="qc-btn primary" onClick={submit} disabled={!canSubmit}>
                {busy ? '…' : 'Добавить в портфель'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
