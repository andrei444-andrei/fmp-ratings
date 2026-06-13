'use client';

import { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'Какая стратегия показала себя лучше всего?',
  'Где были самые большие просадки и когда?',
  'Какими инструментами и как часто торгуют стратегии?',
  'Сколько сделок и по каким активам было в 2015 году?',
];

export default function QuantChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setErr(null);
    const next: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/quantconnect/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      }).then(r => r.json());
      if (res.error) setErr(res.error);
      else setMsgs(m => [...m, { role: 'assistant', content: res.reply || '—' }]);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button className="qc-chat-fab" onClick={() => setOpen(o => !o)} title="AI-ассистент по стратегиям" aria-label="AI-ассистент">
        {open ? '×' : '✨'}
      </button>

      {open && (
        <div className="qc-chat" role="dialog" aria-label="AI-ассистент">
          <div className="qc-chat-h">
            <span className="qc-chat-dot" /> AI-ассистент
            <span className="qc-spacer" />
            {msgs.length > 0 && <button className="qc-chat-clear" onClick={() => setMsgs([])} title="Очистить чат">очистить</button>}
            <button className="qc-modal-x" onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
          </div>

          <div className="qc-chat-body" ref={bodyRef}>
            {msgs.length === 0 ? (
              <div className="qc-chat-empty">
                <p>Спросите про стратегии — отвечу по реальным данным портфеля (доходности, просадки, сравнение с SPY).</p>
                <div className="qc-chat-sugg">
                  {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            ) : msgs.map((m, i) => (
              <div key={i} className={'qc-msg ' + m.role}>
                {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
              </div>
            ))}
            {busy && <div className="qc-msg assistant"><span className="qc-typing">думаю…</span></div>}
            {err && <div className="qc-err" style={{ fontSize: 12 }}>{err}</div>}
          </div>

          <div className="qc-chat-input">
            <textarea value={input} placeholder="Спросить про стратегии…" rows={1}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button className="qc-btn primary" onClick={() => send(input)} disabled={busy || !input.trim()} aria-label="Отправить">↑</button>
          </div>
        </div>
      )}
    </>
  );
}
