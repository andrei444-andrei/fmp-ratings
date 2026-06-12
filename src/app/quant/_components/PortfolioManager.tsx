'use client';

import { useEffect, useState } from 'react';
import AddAlgorithm from './AddAlgorithm';
import Markdown from './Markdown';
import MarkdownEditor from './MarkdownEditor';
import { QC_STATUSES, QC_STATUS_LABEL, type QcAlgoStatus, type QcAlgorithm } from '@/lib/quantconnect/types';

// Управление портфелем стратегий: добавление (кнопка), статус-бейджи, описание,
// редактирование, удаление с подтверждением.
export default function PortfolioManager({
  algos, disabled, onChanged,
}: { algos: QcAlgorithm[]; disabled?: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState<QcAlgorithm | null>(null);
  const [del, setDel] = useState<QcAlgorithm | null>(null);

  return (
    <div className="qc-panel">
      <div className="qc-panel-h">
        Портфель стратегий <span className="c">{algos.length}</span>
        <span className="qc-spacer" />
        <AddAlgorithm disabled={disabled} onAdded={onChanged} />
      </div>

      {algos.length === 0 ? (
        <div className="qc-state" style={{ padding: '20px' }}>Портфель пуст — добавьте стратегию.</div>
      ) : (
        <div className="qc-strats">
          {algos.map(a => (
            <div key={a.id} className={'qc-strat' + (a.status === 'archive' ? ' arch' : '')}>
              <span className={'qc-badge ' + a.status}>{QC_STATUS_LABEL[a.status]}</span>
              <div className="qc-strat-main">
                <div className="qc-strat-name">{a.name}
                  <span className="qc-strat-id">#{a.projectId}{a.backtestId ? ` · bt ${a.backtestId.slice(0, 6)}` : ' · последний'}</span>
                </div>
                {a.description && (
                  <details className="qc-spoiler">
                    <summary>описание</summary>
                    <Markdown text={a.description} />
                  </details>
                )}
              </div>
              <div className="qc-strat-actions">
                <button className="qc-icon" title="Редактировать" onClick={() => setEdit(a)}>✎</button>
                <button className="qc-icon danger" title="Удалить" onClick={() => setDel(a)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && <EditModal algo={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
      {del && <DeleteModal algo={del} onClose={() => setDel(null)} onDeleted={() => { setDel(null); onChanged(); }} />}
    </div>
  );
}

function EditModal({ algo, onClose, onSaved }: { algo: QcAlgorithm; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(algo.name);
  const [status, setStatus] = useState<QcAlgoStatus>(algo.status);
  const [description, setDescription] = useState(algo.description || '');
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function generate() {
    setGen(true); setErr(null);
    try {
      const res = await fetch('/api/quantconnect/describe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: algo.projectId }),
      }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      setDescription(res.description || '');
    } catch (e: any) { setErr(e.message); }
    finally { setGen(false); }
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/quantconnect/algorithms', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: algo.id, name, status, description: description || null }),
      }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="qc-modal-overlay" onMouseDown={onClose}>
      <div className="qc-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="qc-modal-h">
          Редактировать стратегию
          <span className="qc-spacer" />
          <button className="qc-modal-x" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="qc-modal-body">
          <div className="qc-form">
            <div className="qc-field" style={{ gridColumn: 'span 2' }}>
              <label>Метка</label>
              <input className="qc-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
            </div>
            <div className="qc-field">
              <label>Статус</label>
              <select className="qc-select" value={status} onChange={e => setStatus(e.target.value as QcAlgoStatus)}>
                {QC_STATUSES.map(s => <option key={s} value={s}>{QC_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="qc-field" style={{ gridColumn: '1 / -1' }}>
              <label>Описание</label>
              <MarkdownEditor value={description} onChange={setDescription} onGenerate={generate} generating={gen}
                rows={6} placeholder="Markdown: **жирный**, ## заголовок, - список…" />
            </div>
          </div>
          {err && <div className="qc-err" style={{ fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
        <div className="qc-modal-foot">
          <button className="qc-btn" onClick={onClose}>Отмена</button>
          <button className="qc-btn primary" onClick={save} disabled={busy || !name.trim()}>{busy ? '…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ algo, onClose, onDeleted }: { algo: QcAlgorithm; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/quantconnect/algorithms?id=${algo.id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.error) { setErr(res.error); return; }
      onDeleted();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="qc-modal-overlay" onMouseDown={onClose}>
      <div className="qc-modal sm" onMouseDown={e => e.stopPropagation()}>
        <div className="qc-modal-h">Удалить стратегию<span className="qc-spacer" /><button className="qc-modal-x" onClick={onClose} aria-label="Закрыть">×</button></div>
        <div className="qc-modal-body">
          <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
            Удалить стратегию <b>«{algo.name}»</b> из портфеля? Действие <b>необратимо</b>.
          </p>
          {err && <div className="qc-err" style={{ fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
        <div className="qc-modal-foot">
          <button className="qc-btn" onClick={onClose}>Отмена</button>
          <button className="qc-btn danger" onClick={confirm} disabled={busy}>{busy ? '…' : 'Удалить'}</button>
        </div>
      </div>
    </div>
  );
}
