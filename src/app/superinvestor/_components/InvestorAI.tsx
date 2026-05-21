'use client';

import { useEffect, useRef, useState } from 'react';
import { TickerText } from '@/lib/ticker-linkify';

type Msg = { role: 'user' | 'assistant'; content: string; citations?: string[] };

function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'источник'; }
}

function Paragraphs({ text }: { text: string }) {
  const parts = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  return <>{parts.map((p, i) => <p key={i} className="si-ai-p"><TickerText text={p} /></p>)}</>;
}

function Sources({ urls }: { urls?: string[] }) {
  if (!urls || !urls.length) return null;
  return (
    <div className="si-ai-src">
      {urls.slice(0, 8).map((u, i) => (
        <a key={i} href={u} target="_blank" rel="noopener noreferrer" title={u}>{i + 1}. {host(u)}</a>
      ))}
    </div>
  );
}

export default function InvestorAI({ slug }: { slug: string }) {
  const [summary, setSummary] = useState<Msg | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [loadingSum, setLoadingSum] = useState(true);
  const [asking, setAsking] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'ru';

  useEffect(() => {
    let alive = true;
    setLoadingSum(true); setSummary(null); setThread([]); setError(null);
    fetch(`/api/superinvestor/${slug}/ai`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [], lang }),
    })
      .then(r => r.json())
      .then(res => {
        if (!alive) return;
        if (res.error) setError(res.error);
        else setSummary({ role: 'assistant', content: res.answer, citations: res.citations });
        setLoadingSum(false);
      })
      .catch(e => { if (alive) { setError(e.message); setLoadingSum(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [thread, asking]);

  async function ask() {
    const q = input.trim();
    if (!q || asking || !summary) return;
    setInput('');
    setAsking(true);
    const nextThread = [...thread, { role: 'user', content: q } as Msg];
    setThread(nextThread);

    // История для модели: вводный запрос + summary + последующая переписка.
    const messages = [
      { role: 'user', content: 'Дай краткое summary об этом инвесторе.' },
      { role: 'assistant', content: summary.content },
      ...nextThread.map(m => ({ role: m.role, content: m.content })),
    ];
    try {
      const res = await fetch(`/api/superinvestor/${slug}/ai`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, lang }),
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
    <div className="si-panel si-ai">
      <div className="si-panel-h">AI-сводка <span className="c">Perplexity · живой веб</span></div>

      <div className="si-ai-body">
        {loadingSum ? (
          <div>
            <div className="si-skel" style={{ width: '90%' }} />
            <div className="si-skel" style={{ width: '100%', marginTop: 7 }} />
            <div className="si-skel" style={{ width: '75%', marginTop: 7 }} />
            <div className="si-skel" style={{ width: '95%', marginTop: 7 }} />
          </div>
        ) : error ? (
          <div className="si-state si-err" style={{ padding: '10px 0' }}>
            {error}
            {/(ключ|key|AIMLAPI|aimlapi|401|403)/i.test(error) && (
              <><br /><span className="si-mut">Нужен ключ AIMLAPI_KEY (Perplexity Sonar).</span></>
            )}
          </div>
        ) : summary ? (
          <>
            <div className="si-ai-sum"><Paragraphs text={summary.content} /></div>
            <Sources urls={summary.citations} />
          </>
        ) : null}

        {thread.map((m, i) => (
          <div key={i} className={`si-ai-msg ${m.role}`}>
            {m.role === 'assistant' ? <Paragraphs text={m.content} /> : <span>{m.content}</span>}
            {m.role === 'assistant' && <Sources urls={m.citations} />}
          </div>
        ))}
        {asking && <div className="si-ai-msg assistant"><span className="si-mut">генерирую ответ…</span></div>}
        <div ref={bottomRef} />
      </div>

      <div className="si-ai-input-row">
        <textarea
          className="si-input si-ai-input"
          placeholder={summary ? 'Задать вопрос об инвесторе…' : 'Дождитесь сводки…'}
          value={input}
          rows={1}
          disabled={!summary || !!error}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
        />
        <button className="hm-ghost primary" onClick={ask} disabled={!summary || !input.trim() || asking}>
          {asking ? '…' : 'Спросить'}
        </button>
      </div>
    </div>
  );
}
