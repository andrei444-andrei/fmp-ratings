'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Delta, SegmentedControl, Select, Skeleton,
} from '@/components/ui';

type CatStat = { n: number; meanEdge: number; tStat: number; significant: boolean; winRate: number; totalPnl: number };
type Wallet = {
  address: string; n: number; meanEdge: number; tStat: number; pValue: number;
  significant: boolean; winRate: number; totalPnl: number; roi: number; valueUsd: number;
  byCat: Record<string, CatStat>; minHorizon: number;
};
type Data = { wallets: Wallet[]; progress: { candidates: number; scored: number; smart: number } };

const CATS = [
  { value: 'all', label: 'Все категории' },
  { value: 'macro', label: 'Макро / ФРС' },
  { value: 'index', label: 'Индексы' },
  { value: 'megacap', label: 'Мегакапы' },
  { value: 'equity', label: 'Компании' },
  { value: 'commodity', label: 'Сырьё' },
  { value: 'crypto', label: 'Крипто' },
];

const money = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const profileUrl = (a: string) => `https://polymarket.com/profile/${a}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function PpEdge({ value }: { value: number }) {
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <Delta value={value * 100} percent={false} decimals={1} size="sm" />
      <span className="text-[10px] text-ink-3">пп</span>
    </span>
  );
}

function WalletRow({ w, cat }: { w: Wallet; cat: string }) {
  const [open, setOpen] = useState(false);
  // если выбрана категория — показываем её срез, иначе общий
  const s = cat !== 'all' && w.byCat[cat] ? w.byCat[cat] : null;
  const n = s ? s.n : w.n;
  const edge = s ? s.meanEdge : w.meanEdge;
  const winRate = s ? s.winRate : w.winRate;
  const pnl = s ? s.totalPnl : w.totalPnl;
  const sig = s ? s.significant : w.significant;

  return (
    <div className="rounded-fk px-3 py-2.5 hover:bg-surface-2 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a href={profileUrl(w.address)} target="_blank" rel="noreferrer"
               className="text-sm font-medium text-ink hover:underline tabular-nums">{short(w.address)}</a>
            {sig
              ? <Badge variant="up" size="sm">значим</Badge>
              : <Badge variant="neutral" size="sm">не значим</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-ink-2">
            <span>edge <PpEdge value={edge} /></span>
            <span>винрейт <b className="tabular-nums">{(winRate * 100).toFixed(0)}%</b></span>
            <span>n=<b className="tabular-nums">{n}</b></span>
            <span>PnL <b className="tabular-nums">{money(pnl)}</b></span>
            <span>портфель <b className="tabular-nums">{money(w.valueUsd)}</b></span>
            <button type="button" className="text-brand-700 hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? 'скрыть ▴' : 'по категориям ▾'}
            </button>
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-2 sm:ml-2 rounded-fk bg-surface-2 px-3 py-2">
          <div className="text-[11px] font-medium text-ink-3 mb-1.5">Edge по категориям событий (горизонт ≥ {w.minHorizon}д)</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {Object.entries(w.byCat).filter(([, v]) => v.n > 0).sort((a, b) => b[1].meanEdge - a[1].meanEdge).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1.5 text-xs">
                <span className="text-ink-3 w-16">{CATS.find((c) => c.value === k)?.label ?? k}</span>
                <PpEdge value={v.meanEdge} />
                <span className="text-ink-3 tabular-nums">n={v.n}</span>
                {v.significant && <Badge variant="up" size="sm">✓</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
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
  const [minN, setMinN] = useState(20);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ category: cat, minN: String(minN), sigOnly: sigOnly ? '1' : '0' });
      const r = await fetch(`/api/polymarket/wallets?${qs}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) { setError(e?.message || 'Не удалось загрузить'); }
    finally { setLoading(false); }
  }, [cat, minN, sigOnly]);

  useEffect(() => { load(); }, [load]);

  const crawl = useCallback(async (discover: boolean) => {
    setCrawling(true); setError(null);
    try {
      const r = await fetch('/api/polymarket/wallets?' + (discover ? 'discover=1' : ''), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discover, scoreWallets: 20, minHorizonDays: 7, minN }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
    } catch (e: any) { setError(e?.message || 'Краул не удался'); }
    finally { setCrawling(false); }
  }, [load, minN]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink flex items-center gap-2">
            Умные деньги <Badge variant="brand">beta</Badge>
          </h1>
          <p className="mt-1 text-sm text-ink-2 max-w-2xl">
            Кошельки со <b>статистически значимым edge над рынком</b> на разрешённых событиях
            (edge = исход − цена входа; учитывает шансы). Фильтр по типу событий и горизонту ≥ 7 дней.
            Идея: найти тех, кто реально предсказывает нужный тип событий.
          </p>
          <a href="/polymarket" className="text-xs text-brand-700 hover:underline">← к сводке Polymarket</a>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-3 flex-wrap">
        <SegmentedControl value={cat} onChange={setCat} size="sm"
          options={CATS.map((c) => ({ value: c.value, label: c.label }))} />
        <label className="text-sm text-ink-2 flex items-center gap-1.5">
          мин. n
          <input type="number" value={minN} min={1} onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))}
                 className="w-16 rounded-fk border border-line bg-surface px-2 py-1 text-sm tabular-nums" />
        </label>
        <label className="text-sm text-ink-2 flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={sigOnly} onChange={(e) => setSigOnly(e.target.checked)} />
          только значимые
        </label>
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => crawl(false)} disabled={crawling}>
          {crawling ? 'Сканирую…' : 'Оценить ещё'}
        </Button>
        <Button onClick={() => crawl(true)} disabled={crawling}>
          {crawling ? 'Сканирую…' : 'Найти + оценить'}
        </Button>
      </div>

      {data && (
        <p className="mt-2 text-xs text-ink-3">
          В пуле кандидатов: {data.progress.candidates} · оценено: {data.progress.scored} ·
          в базе кошельков: {data.progress.smart}
        </p>
      )}

      {error && <div className="mt-4 rounded-fk bg-down-soft text-down-strong text-sm px-4 py-3">Ошибка: {error}</div>}

      {loading && !data && <div className="mt-6 grid gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}

      {data && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Лидерборд кошельков{cat !== 'all' ? ` — ${CATS.find((c) => c.value === cat)?.label}` : ''}</CardTitle>
            <CardDescription>
              Сортировка: сперва значимые, затем по среднему edge. Клик по адресу — профиль на Polymarket.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.wallets.length ? (
              <div className="-mx-2 divide-y divide-line">
                {data.wallets.map((w) => <WalletRow key={w.address} w={w} cat={cat} />)}
              </div>
            ) : (
              <div className="text-sm text-ink-3 py-4">
                Пока пусто. Нажми <b>«Найти + оценить»</b> — соберём кандидатов (холдеры топ-рынков)
                и посчитаем их edge. Краул батчами: жми «Оценить ещё», чтобы добрать.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-xs text-ink-3">
        Значимость: n ≥ порога, средний edge &gt; 0, одностороннее p &lt; 0.05. Это историческая
        предсказательная сила, не гарантия будущего. Для фондового рынка смотри edge по категориям
        макро/индексы/мегакапы/компании/сырьё.
      </p>
    </main>
  );
}
