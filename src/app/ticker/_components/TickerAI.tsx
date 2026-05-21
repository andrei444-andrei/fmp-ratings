'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string; citations?: string[] };

const SECTIONS = [
  'company overview', 'sector & industry', 'sector and industry', 'geography',
  'revenue drivers', 'customers', 'competitive position', 'key financial snapshot',
  'recent developments', 'bloomberg-style summary', 'bloomberg style summary',
];
const SECTION_SET = new Set(SECTIONS);

function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'источник'; }
}

function cleanLine(s: string): string {
  return s.replace(/^[#>\s]*/, '').replace(/\*\*/g, '').replace(/[*_`]/g, '').trim();
}

function asHeading(line: string): string | null {
  const c = cleanLine(line).replace(/[:\-–—]+\s*$/, '').trim();
  return c.length <= 40 && SECTION_SET.has(c.toLowerCase()) ? c : null;
}

// Рендер ответа: строки-разделы → заголовки, остальное → абзацы.
function Rendered({ text }: { text: string }) {
  const lines = text.split(/\n/);
  const blocks: { type: 'h' | 'p'; text: string }[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.length) { blocks.push({ type: 'p', text: buf.join(' ') }); buf = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = asHeading(line);
    if (h) { flush(); blocks.push({ type: 'h', text: h }); }
    else buf.push(cleanLine(line));
  }
  flush();
  return (
    <>
      {blocks.map((b, i) =>
        b.type === 'h'
          ? <div key={i} className="tk-ai-h">{b.text}</div>
          : <p key={i} className="si-ai-p">{b.text}</p>
      )}
    </>
  );
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

export default function TickerAI({ symbol, name }: { symbol: string; name?: string }) {
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
    fetch(`/api/ticker/${encodeURIComponent(symbol)}/ai`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [], name, lang }),
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
  }, [symbol]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [thread, asking]);

  async function ask() {
    const q = input.trim();
    if (!q || asking || !summary) return;
    setInput('');
    setAsking(true);
    const nextThread = [...thread, { role: 'user', content: q } as Msg];
    setThread(nextThread);

    const messages = [
      { role: 'user', content: `Дай summary компании ${name || symbol} в стиле Bloomberg DES.` },
      { role: 'assistant', content: summary.content },
      ...nextThread.map(m => ({ role: m.role, content: m.content })),
    ];
    try {
      const res = await fetch(`/api/ticker/${encodeURIComponent(symbol)}/ai`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, name, lang }),
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
      <div className="si-panel-h">Summary компании <span className="c">Bloomberg DES · Perplexity · живой веб</span></div>

      <div className="si-ai-body">
        {loadingSum ? (
          <div>
            <div className="si-skel" style={{ width: '40%' }} />
            <div className="si-skel" style={{ width: '100%', marginTop: 7 }} />
            <div className="si-skel" style={{ width: '92%', marginTop: 7 }} />
            <div className="si-skel" style={{ width: '40%', marginTop: 14 }} />
            <div className="si-skel" style={{ width: '96%', marginTop: 7 }} />
            <div className="si-skel" style={{ width: '80%', marginTop: 7 }} />
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
            <div className="si-ai-sum"><Rendered text={summary.content} /></div>
            <Sources urls={summary.citations} />
          </>
        ) : null}

        {thread.map((m, i) => (
          <div key={i} className={`si-ai-msg ${m.role}`}>
            {m.role === 'assistant' ? <Rendered text={m.content} /> : <span>{m.content}</span>}
            {m.role === 'assistant' && <Sources urls={m.citations} />}
          </div>
        ))}
        {asking && <div className="si-ai-msg assistant"><span className="si-mut">генерирую ответ…</span></div>}
        <div ref={bottomRef} />
      </div>

      <div className="si-ai-input-row">
        <textarea
          className="si-input si-ai-input"
          placeholder={summary ? 'Задать вопрос о компании…' : 'Дождитесь сводки…'}
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
