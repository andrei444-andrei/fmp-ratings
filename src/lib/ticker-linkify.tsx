'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

// Превращает упоминания тикеров в тексте в ссылки на /ticker/<SYMBOL>.
// Кандидаты: $-кэштеги ($AAPL) и слова из заглавных букв (AAPL, BRK.B).
// Реальность тикера проверяется на бэке (POST /api/ticker/verify) со сверкой
// по FMP; результат кэшируется в модуле, чтобы не дёргать API повторно.

// $TSLA  или  слово из 2–5 заглавных (опц. ".X", напр. BRK.B), по границам слова.
const TOKEN_RE = /\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)|\b([A-Z]{2,5}(?:\.[A-Z])?)\b/g;

// Частые аббревиатуры/слова капсом, которые не стоит линковать, даже если
// формально существует тикер с таким именем.
const STOP = new Set([
  'CEO', 'CFO', 'CTO', 'COO', 'IPO', 'ETF', 'ETFS', 'GDP', 'CPI', 'PPI', 'EPS',
  'PE', 'PEG', 'ROE', 'ROI', 'ROIC', 'EBIT', 'EBITDA', 'FCF', 'TTM', 'YTD',
  'YOY', 'QOQ', 'FY', 'AI', 'ML', 'API', 'URL', 'SEC', 'FED', 'FOMC', 'ECB',
  'NYSE', 'NASDAQ', 'AMEX', 'SPAC', 'ESG', 'IT', 'HR', 'PR', 'FAQ', 'USD',
  'EUR', 'GBP', 'JPY', 'CNY', 'USA', 'US', 'UK', 'EU', 'UN', 'GAAP', 'IFRS',
  'OK', 'ID', 'TV', 'PC', 'OS', 'UI', 'UX', 'VS', 'NA', 'NO', 'CAGR', 'NAV',
  'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'M&A', 'R&D',
]);

type Part = { text: string } | { symbol: string; raw: string };

function tokenize(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const raw = m[0];
    const sym = (m[1] || m[2] || '').toUpperCase();
    if (!sym || STOP.has(sym)) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ symbol: sym, raw });
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function candidatesIn(text: string): string[] {
  return tokenize(text).flatMap(p => ('symbol' in p ? [p.symbol] : []));
}

// --- модульный кэш + батч-верификация через один fetch ---
const cache = new Map<string, boolean>(); // symbol → реальный тикер?
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function flush() {
  timer = null;
  const batch = [...queue];
  queue = new Set();
  if (!batch.length) return;
  fetch('/api/ticker/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbols: batch }),
  })
    .then(r => r.json())
    .then((res: { valid?: string[] }) => {
      const valid = new Set((res.valid || []).map(s => s.toUpperCase()));
      for (const s of batch) cache.set(s, valid.has(s));
    })
    .catch(() => {
      for (const s of batch) cache.set(s, false); // graceful: текст без ссылок
    })
    .finally(() => listeners.forEach(fn => fn()));
}

function enqueue(symbols: string[]): void {
  let added = false;
  for (const s of symbols) {
    if (!cache.has(s) && !queue.has(s)) { queue.add(s); added = true; }
  }
  if (added && !timer) timer = setTimeout(flush, 50);
}

function renderParts(text: string): ReactNode {
  return tokenize(text).map((p, i) => {
    if ('text' in p) return <Fragment key={i}>{p.text}</Fragment>;
    if (cache.get(p.symbol) === true) {
      return (
        <Link key={i} href={`/ticker/${encodeURIComponent(p.symbol)}`} className="tk-link">
          {p.raw}
        </Link>
      );
    }
    return <Fragment key={i}>{p.raw}</Fragment>;
  });
}

// Рендерит строку, заменяя реальные тикеры на ссылки. Незнакомые кандидаты
// ставятся в очередь проверки; после ответа компонент перерисуется.
export function TickerText({ text }: { text: string }): React.ReactElement {
  const [, force] = useState(0);
  useEffect(() => {
    const cands = candidatesIn(text);
    const unknown = cands.filter(c => !cache.has(c));
    if (unknown.length) enqueue(unknown);
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [text]);
  return <>{renderParts(text)}</>;
}
