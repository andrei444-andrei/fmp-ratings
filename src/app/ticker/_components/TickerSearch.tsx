'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Hit = { symbol: string; name: string; exchange: string };

export default function TickerSearch({ autoFocus = false, placeholder = 'Тикер или название компании…' }: {
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ticker/search?q=${encodeURIComponent(term)}`).then(r => r.json());
        setHits(Array.isArray(res.results) ? res.results.slice(0, 10) : []);
        setActive(0);
      } catch { setHits([]); }
      finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function go(sym: string) {
    const s = sym.toUpperCase().trim();
    if (!s) return;
    setOpen(false);
    router.push(`/ticker/${encodeURIComponent(s)}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && hits[active]) go(hits[active].symbol);
      else if (q.trim()) go(q.trim());
    } else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="tk-search" ref={boxRef}>
      <input
        className="tk-search-in"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        spellCheck={false}
        autoComplete="off"
      />
      {open && q.trim().length >= 1 && (
        <div className="tk-search-pop">
          {hits.map((h, i) => (
            <button
              key={`${h.symbol}-${i}`}
              className={`tk-search-row${i === active ? ' on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h.symbol)}
            >
              <span className="sym">{h.symbol}</span>
              <span className="nm">{h.name}</span>
              <span className="ex">{h.exchange}</span>
            </button>
          ))}
          {!hits.length && (
            <div className="tk-search-empty">
              {loading ? 'Поиск…' : <>Enter — открыть <b>{q.trim().toUpperCase()}</b></>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
