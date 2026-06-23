'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Card, CardContent, SegmentedControl, Skeleton, Spinner,
} from '@/components/ui';

type CatStat = { n: number; meanEdge: number; tStat: number; significant: boolean; winRate: number; totalPnl: number };
type Wallet = {
  address: string; n: number; meanEdge: number; tStat: number; pValue: number;
  significant: boolean; winRate: number; totalPnl: number; roi: number; valueUsd: number;
  byCat: Record<string, CatStat>; minHorizon: number;
};
type Data = { wallets: Wallet[]; progress: { candidates: number; scored: number; smart: number } };

const CATS = [
  { value: 'all', label: 'Все' },
  { value: 'macro', label: 'Макро / ФРС' },
  { value: 'index', label: 'Индексы' },
  { value: 'megacap', label: 'Мегакапы' },
  { value: 'equity', label: 'Компании' },
  { value: 'commodity', label: 'Сырьё' },
  { value: 'crypto', label: 'Крипто' },
];
const catLabel = (k: string) => CATS.find((c) => c.value === k)?.label ?? k;

const money = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const pp = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
const profileUrl = (a: string) => `https://polymarket.com/profile/${a}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const edgeColor = (e: number) => (e > 0.005 ? 'text-up-strong' : e < -0.005 ? 'text-down-strong' : 'text-ink-2');

type SortKey = 'edge' | 'winRate' | 'pnl' | 'n' | 'value';

// Горизонтальный бар edge: вправо зелёный (+), влево красный (−), центр = 0.
function EdgeBar({ edge }: { edge: number }) {
  const w = Math.min(50, Math.abs(edge) * 100); // % от полуширины (cap 50пп)
  const pos = edge >= 0;
  return (
    <div className="relative h-3 w-24 rounded-full bg-surface-2 overflow-hidden" title={`${pp(edge)} пп`}>
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-line" />
      <div
        className={`absolute top-0 bottom-0 ${pos ? 'bg-up-strong' : 'bg-down-strong'}`}
        style={pos ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
      />
    </div>
  );
}

function CatChips({ w }: { w: Wallet }) {
  const items = Object.entries(w.byCat).filter(([, v]) => v.n > 0).sort((a, b) => b[1].meanEdge - a[1].meanEdge);
  if (!items.length) return <div className="text-xs text-ink-3">нет разрешённых пари по категориям</div>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([k, v]) => (
        <div key={k} className={`flex items-center gap-1.5 rounded-fk border border-line px-2 py-1 text-xs ${v.significant ? 'bg-up-soft' : 'bg-surface'}`}>
          <span className="text-ink-2">{catLabel(k)}</span>
          <span className={`font-semibold tabular-nums ${edgeColor(v.meanEdge)}`}>{pp(v.meanEdge)}пп</span>
          <span className="text-ink-3 tabular-nums">n{v.n}</span>
          {v.significant && <span className="text-up-strong">✓</span>}
        </div>
      ))}
    </div>
  );
}

function WalletCard({ w, rank, cat }: { w: Wallet; rank: number; cat: string }) {
  const [open, setOpen] = useState(false);
  const s = cat !== 'all' && w.byCat[cat] ? w.byCat[cat] : null;
  const edge = s ? s.meanEdge : w.meanEdge;
  const n = s ? s.n : w.n;
  const winRate = s ? s.winRate : w.winRate;
  const pnl = s ? s.totalPnl : w.totalPnl;
  const sig = s ? s.significant : w.significant;

  return (
    <div className="border-b border-line last:border-0">
      <div className="grid grid-cols-[28px_1fr_auto] sm:grid-cols-[32px_minmax(0,1.4fr)_96px_72px_56px_84px_84px_24px] items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-surface-2 transition-colors">
        <span className="text-xs text-ink-3 tabular-nums text-right">{rank}</span>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a href={profileUrl(w.address)} target="_blank" rel="noreferrer"
               className="text-sm font-medium text-ink hover:underline tabular-nums truncate">{short(w.address)}</a>
            {sig
              ? <Badge variant="up" size="sm">значим p&lt;0.05</Badge>
              : <Badge variant="neutral" size="sm">не значим</Badge>}
          </div>
          {/* мобильная строка-сводка */}
          <div className="sm:hidden mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-2">
            <span className={edgeColor(edge)}>edge {pp(edge)}пп</span>
            <span>WR {(winRate * 100).toFixed(0)}%</span>
            <span>n {n}</span>
            <span className={pnl >= 0 ? 'text-up-strong' : 'text-down-strong'}>PnL {money(pnl)}</span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          <EdgeBar edge={edge} />
          <span className={`text-sm font-semibold tabular-nums ${edgeColor(edge)}`}>{pp(edge)}</span>
        </div>
        <span className="hidden sm:block text-sm tabular-nums text-right">{(winRate * 100).toFixed(0)}%</span>
        <span className="hidden sm:block text-sm tabular-nums text-right text-ink-2">{n}</span>
        <span className={`hidden sm:block text-sm tabular-nums text-right font-medium ${pnl >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>{money(pnl)}</span>
        <span className="hidden sm:block text-sm tabular-nums text-right text-ink-2">{money(w.valueUsd)}</span>

        <button type="button" onClick={() => setOpen((v) => !v)}
                className="text-ink-3 hover:text-ink justify-self-end" aria-label="по категориям">
          <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3 sm:pl-[44px]">
          <div className="text-[11px] text-ink-3 mb-1.5">Edge по типам событий (горизонт ≥ {w.minHorizon}д) · ROI {(w.roi * 100).toFixed(0)}%</div>
          <CatChips w={w} />
        </div>
      )}
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="hidden sm:grid grid-cols-[32px_minmax(0,1.4fr)_96px_72px_56px_84px_84px_24px] items-center gap-x-3 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-3 border-b border-line">
      <span className="text-right">#</span>
      <span>Кошелёк</span>
      <span>Edge</span>
      <span className="text-right">Винрейт</span>
      <span className="text-right">N</span>
      <span className="text-right">PnL</span>
      <span className="text-right">Портфель</span>
      <span />
    </div>
  );
}

export default function SmartWalletsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [cat, setCat] = useState('all');
  const [sigOnly, setSigOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('edge');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ category: cat, sigOnly: sigOnly ? '1' : '0', limit: '200' });
      const r = await fetch(`/api/polymarket/wallets?${qs}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) { setError(e?.message || 'Не удалось загрузить'); }
    finally { setLoading(false); }
  }, [cat, sigOnly]);

  useEffect(() => { load(); }, [load]);

  const crawl = useCallback(async (discover: boolean) => {
    setCrawling(true); setError(null);
    try {
      const r = await fetch('/api/polymarket/wallets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discover, scoreWallets: 60, minHorizonDays: 7, minN: 20 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
    } catch (e: any) { setError(e?.message || 'Скан не удался'); }
    finally { setCrawling(false); }
  }, [load]);

  const reset = useCallback(async () => {
    if (!confirm('Очистить базу посчитанных кошельков и пересчитать заново?')) return;
    setCrawling(true); setError(null);
    try {
      await fetch('/api/polymarket/wallets?reset=1', { method: 'POST' });
      await load();
    } catch (e: any) { setError(e?.message || 'Сброс не удался'); }
    finally { setCrawling(false); }
  }, [load]);

  const wallets = useMemo(() => {
    if (!data) return [];
    const get = (w: Wallet) => {
      const s = cat !== 'all' && w.byCat[cat] ? w.byCat[cat] : null;
      switch (sort) {
        case 'winRate': return s ? s.winRate : w.winRate;
        case 'pnl': return s ? s.totalPnl : w.totalPnl;
        case 'n': return s ? s.n : w.n;
        case 'value': return w.valueUsd;
        default: return s ? s.meanEdge : w.meanEdge;
      }
    };
    return [...data.wallets].sort((a, b) => (b.significant ? 1 : 0) - (a.significant ? 1 : 0) || get(b) - get(a));
  }, [data, sort, cat]);

  const sigCount = data ? data.wallets.filter((w) => (cat !== 'all' && w.byCat[cat] ? w.byCat[cat].significant : w.significant)).length : 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink flex items-center gap-2">Умные деньги <Badge variant="brand">beta</Badge></h1>
          <p className="mt-1 text-sm text-ink-2 max-w-2xl">
            Кошельки со <b>статистически значимым edge над рынком</b> (edge = исход − цена входа; учитывает шансы).
            Значимость: n ≥ 20, edge &gt; 0, одностороннее p &lt; 0.05.
          </p>
          <a href="/polymarket" className="text-xs text-brand-700 hover:underline">← к сводке Polymarket</a>
        </div>
      </div>

      {/* сводка-метрики */}
      {data && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Кандидатов в пуле', value: data.progress.candidates.toLocaleString('ru-RU') },
            { label: 'Оценено кошельков', value: data.progress.scored.toLocaleString('ru-RU') },
            { label: 'Значимых найдено', value: String(sigCount), accent: sigCount > 0 },
          ].map((s) => (
            <Card key={s.label}><CardContent className="py-3">
              <div className="text-xs text-ink-3">{s.label}</div>
              <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${s.accent ? 'text-up-strong' : 'text-ink'}`}>{s.value}</div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* тулбар */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <SegmentedControl value={cat} onChange={setCat} size="sm" options={CATS.map((c) => ({ value: c.value, label: c.label }))} />
        <label className="text-sm text-ink-2 flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={sigOnly} onChange={(e) => setSigOnly(e.target.checked)} /> только значимые
        </label>
        <span className="flex-1" />
        <button type="button" onClick={reset} disabled={crawling}
                className="text-xs text-ink-3 hover:text-down-strong disabled:opacity-50">сбросить</button>
        <Button variant="secondary" onClick={() => crawl(false)} disabled={crawling}>
          {crawling ? <span className="inline-flex items-center gap-2"><Spinner /> Сканирую…</span> : 'Оценить пачку'}
        </Button>
        <Button onClick={() => crawl(true)} disabled={crawling}>
          {crawling ? 'Сканирую…' : 'Найти + оценить'}
        </Button>
      </div>

      {error && <div className="mt-4 rounded-fk bg-down-soft text-down-strong text-sm px-4 py-3">Ошибка: {error}</div>}
      {crawling && <div className="mt-3 text-xs text-ink-3">Скан идёт пачками (до ~45с): тянем позиции, считаем edge по разрешённым рынкам и пишем в базу…</div>}

      {loading && !data && <div className="mt-4 grid gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}

      {data && (
        <Card className="mt-4">
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-line">
              <div className="text-sm font-medium text-ink">
                Лидерборд{cat !== 'all' ? ` · ${catLabel(cat)}` : ''} <span className="text-ink-3 font-normal">({wallets.length})</span>
              </div>
              <label className="text-xs text-ink-2 flex items-center gap-1.5">
                сортировка
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
                        className="rounded-fk border border-line bg-surface px-2 py-1 text-xs">
                  <option value="edge">по edge</option>
                  <option value="winRate">по винрейту</option>
                  <option value="pnl">по PnL</option>
                  <option value="n">по числу пари</option>
                  <option value="value">по портфелю</option>
                </select>
              </label>
            </div>

            {wallets.length ? (
              <>
                <HeaderRow />
                {wallets.map((w, i) => <WalletCard key={w.address} w={w} rank={i + 1} cat={cat} />)}
              </>
            ) : (
              <div className="px-4 py-10 text-center">
                <div className="text-sm text-ink-2">
                  {data.progress.scored === 0
                    ? <>База пуста. Нажми <b>«Найти + оценить»</b> — соберём кандидатов (холдеры топ-рынков) и посчитаем их edge.</>
                    : <>В этом срезе нет кошельков{cat !== 'all' ? ` с историей в категории «${catLabel(cat)}»` : ''}{sigOnly ? ' среди значимых' : ''}.</>}
                </div>
                <div className="mt-2 text-xs text-ink-3">
                  Значимые «умные деньги» редки — жми <b>«Оценить пачку»</b> ещё несколько раз, база копится на бэке.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-xs text-ink-3">
        Это историческая предсказательная сила, не гарантия будущего. Для фондового рынка смотри edge
        по категориям макро / индексы / мегакапы / компании / сырьё (раскрой строку «▾»).
      </p>
    </main>
  );
}
