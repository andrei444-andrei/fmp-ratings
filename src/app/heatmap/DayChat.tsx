'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string; citations?: string[] };

function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'источник'; }
}

function Paragraphs({ text }: { text: string }) {
  const parts = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  return <>{parts.map((p, i) => <p key={i} className="hm-chat-p">{p}</p>)}</>;
}

function Sources({ urls }: { urls?: string[] }) {
  if (!urls || !urls.length) return null;
  return (
    <div className="hm-ai-src">
      {urls.slice(0, 8).map((u, i) => (
        <a key={i} href={u} target="_blank" rel="noopener noreferrer" title={u}>{i + 1}. {host(u)}</a>
      ))}
    </div>
  );
}

// AI-чат в контексте выбранного дня. Промпт = новости дня + дата + вопрос.
export default function DayChat({ date, news }: { date: string; news: string }) {
  const [thread, setThread] = useState<Msg[]>([]);
  const [asking, setAsking] = useState(false);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'ru';

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread, asking]);

  async function ask() {
    const q = input.trim();
    if (!q || asking) return;
    setInput('');
    setAsking(true);
    const nextThread: Msg[] = [...thread, { role: 'user', content: q }];
    setThread(nextThread);
    try {
      const res = await fetch('/api/heatmap/day-chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, news, lang, messages: nextThread.map(m => ({ role: m.role, content: m.content })) }),
      }).then(r => r.json());
      setThread(t => [...t, res.error
        ? { role: 'assistant', content: '⚠ ' + res.error }
        : { role: 'assistant', content: res.answer, citations: res.citations }]);
    } catch (e: any) {
      setThread(t => [...t, { role: 'assistant', content: '⚠ ' + e.message }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="hm-chat">
      <div className="hm-nw-h">
        <span>Спросить AI про этот день</span>
        <span className="src">Perplexity · живой веб</span>
      </div>

      {thread.length > 0 && (
        <div className="hm-chat-body">
          {thread.map((m, i) => (
            <div key={i} className={`hm-chat-msg ${m.role}`}>
              {m.role === 'assistant' ? <Paragraphs text={m.content} /> : <span>{m.content}</span>}
              {m.role === 'assistant' && <Sources urls={m.citations} />}
            </div>
          ))}
          {asking && <div className="hm-chat-msg assistant"><span className="hm-muted">генерирую ответ…</span></div>}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="hm-chat-input-row">
        <textarea
          className="hm-chat-input"
          placeholder={`Вопрос о дне ${date}…`}
          value={input}
          rows={1}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
        />
        <button className="hm-ghost primary" onClick={ask} disabled={!input.trim() || asking}>
          {asking ? '…' : 'Спросить'}
        </button>
      </div>
    </div>
  );
}
