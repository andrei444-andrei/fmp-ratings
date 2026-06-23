'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Delta,
  SegmentedControl,
  Skeleton,
  Sparkline,
} from '@/components/ui';

type Move = {
  d6h: number; d24h: number; d3d: number; d7d: number; d30d: number;
  breakScore: number; accel: number; reversal: boolean; volSpike: boolean;
  direction: -1 | 0 | 1; points: number; spark: number[];
  daily?: { t: number; p: number }[];
};
type Market = {
  id: string; question: string; ru: string; slug: string;
  cat: string | null; prob: number; vol: number; liq: number;
  spread: number; daysLeft: number | null; move: Move | null;
};
type Cat = { key: string; label: string; desc: string; markets: Market[] };
type Data = {
  fetchedAt: string; totalScanned: number; hasHistory: boolean; translated: boolean;
  categories: Cat[]; movers: Market[]; cached?: boolean; stale?: boolean;
};

type Win = '24h' | '3d' | '7d';

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function probVariant(p: number): 'up' | 'down' | 'warn' {
  if (p >= 0.66) return 'up';
  if (p <= 0.34) return 'down';
  return 'warn';
}
function pmUrl(slug: string) {
  return slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com';
}
function winDelta(m: Move, w: Win) {
  return w === '24h' ? m.d24h : w === '3d' ? m.d3d : m.d7d;
}

function Flags({ m }: { m: Move }) {
  return (
    <span className="flex items-center gap-1">
      {m.reversal && <Badge variant="warn" size="sm" title="Последние сутки развернули тренд прошлой недели">🔄 разворот</Badge>}
      {m.accel > 0.02 && !m.reversal && <Badge variant="brand" size="sm" title="Движение за сутки выше недельного темпа">⚡ ускорение</Badge>}
      {m.volSpike && <Badge variant="down" size="sm" title="Всплеск волатильности за последние сутки">📊 всплеск</Badge>}
    </span>
  );
}

// Изменение вероятности в процентных пунктах.
function PpDelta({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <Delta value={value * 100} percent={false} decimals={1} size={size} />
      <span className="text-[10px] text-ink-3">пп</span>
    </span>
  );
}

const dmy = (t: number) =>
  new Date(t * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

// Развёрнутая динамика по дням: вероятность и Δ к предыдущему дню.
function DailyBreakdown({ daily }: { daily: { t: number; p: number }[] }) {
  if (!daily || daily.length < 2) {
    return <div className="text-xs text-ink-3 py-1">Дневных данных пока недостаточно.</div>;
  }
  const rows = daily.map((d, i) => ({
    t: d.t,
    p: d.p,
    delta: i > 0 ? d.p - daily[i - 1].p : null,
  }));
  return (
    <div className="rounded-fk bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-medium text-ink-3 mb-1.5">
        Динамика по дням — вероятность и изменение к предыдущему дню
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {rows.slice().reverse().map((r) => (
          <div key={r.t} className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-[11px] text-ink-3 w-10">{dmy(r.t)}</span>
            <span className="text-sm text-ink font-medium w-10">{pct(r.p)}</span>
            {r.delta != null ? <PpDelta value={r.delta} /> : <span className="text-[10px] text-ink-3">старт</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Единая строка рынка: полный текст прогноза + явные дельты по окнам +
// разворачиваемая динамика по дням. `metric` — что показать справа (ликв./объём).
function Row({ m, metric }: { m: Market; metric: 'liq' | 'vol' }) {
  const [open, setOpen] = useState(false);
  const mv = m.move;
  return (
    <div className="rounded-fk px-3 py-2.5 hover:bg-surface-2 transition-colors">
      <div className="flex items-start gap-3">
        <Badge variant={probVariant(m.prob)} className="w-12 justify-center tabular-nums shrink-0 mt-0.5">
          {pct(m.prob)}
        </Badge>
        <div className="flex-1 min-w-0">
          {/* полный текст прогноза, без обрезки */}
          <a href={pmUrl(m.slug)} target="_blank" rel="noreferrer"
             className="text-sm text-ink hover:underline block">
            {m.ru}
          </a>
          {m.ru !== m.question && (
            <div className="text-[11px] text-ink-3 mt-0.5">{m.question}</div>
          )}
          <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
            {mv ? (
              <>
                <span className="text-ink-3">24ч</span><PpDelta value={mv.d24h} />
                <span className="text-ink-3">3д</span><PpDelta value={mv.d3d} />
                <span className="text-ink-3">7д</span><PpDelta value={mv.d7d} />
                <Flags m={mv} />
                <button type="button" onClick={() => setOpen((v) => !v)}
                        className="text-brand-700 hover:underline">
                  {open ? 'скрыть дни ▴' : 'по дням ▾'}
                </button>
              </>
            ) : (
              <span className="text-ink-3">история недоступна</span>
            )}
          </div>
        </div>
        {mv && mv.spark.length > 1 && (
          <Sparkline data={mv.spark} width={84} height={28} className="shrink-0 hidden sm:block mt-1" />
        )}
        <div className="shrink-0 text-right hidden md:block w-16">
          <div className="text-xs text-ink-3 tabular-nums">{money(metric === 'liq' ? m.liq : m.vol)}</div>
          <div className="text-[10px] text-ink-3 tabular-nums">{m.daysLeft != null ? `${m.daysLeft}д` : '—'}</div>
        </div>
      </div>
      {open && mv && <div className="mt-2 sm:ml-[3.75rem]"><DailyBreakdown daily={mv.daily || []} /></div>}
    </div>
  );
}

export default function PolymarketPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [win, setWin] = useState<Win>('24h');
  const [onlyMoves, setOnlyMoves] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/polymarket${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const movers = useMemo(() => {
    if (!data) return [];
    const arr = [...data.movers].filter((m) => m.move);
    arr.sort((a, b) => Math.abs(winDelta(b.move!, win)) - Math.abs(winDelta(a.move!, win)));
    return arr.filter((m) => Math.abs(winDelta(m.move!, win)) >= 0.03);
  }, [data, win]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink flex items-center gap-2">
            Polymarket <Badge variant="brand">v2</Badge>
          </h1>
          <p className="mt-1 text-sm text-ink-2 max-w-2xl">
            Подразумеваемые вероятности рынков предсказаний как макро-фон и сигнал относительной силы.
            Вверху — <b>где закономерность поменялась</b> за последние дни (разворот тренда, ускорение,
            всплеск волатильности). Вопросы переведены на русский.
          </p>
        </div>
        <Button onClick={() => load(true)} disabled={loading} variant="secondary">
          {loading ? 'Обновляю…' : 'Обновить'}
        </Button>
      </div>

      <a href="/polymarket/wallets" className="mt-2 inline-block text-sm text-brand-700 hover:underline">
        🧠 Умные деньги — кошельки со значимым edge →
      </a>

      {data && (
        <p className="mt-2 text-xs text-ink-3">
          Источник: gamma + clob.polymarket.com · отсканировано {data.totalScanned} активных рынков ·
          обновлено {new Date(data.fetchedAt).toLocaleString('ru-RU')}
          {data.cached ? ' · из кэша' : ''}{data.stale ? ' (устаревший — источник недоступен)' : ''}
          {!data.translated ? ' · перевод недоступен (нет AIMLAPI_KEY)' : ''}
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-fk bg-down-soft text-down-strong text-sm px-4 py-3">Ошибка: {error}</div>
      )}

      {loading && !data && (
        <div className="mt-6 grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      )}

      {data && (
        <>
          {/* СДВИГИ ЗАКОНОМЕРНОСТЕЙ */}
          <Card className="mt-6 border-brand-200">
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle>🔥 Сдвиги закономерностей</CardTitle>
                  <CardDescription>
                    Рынки, где вероятность заметно изменилась за окно. Δ — изменение в процентных пунктах.
                  </CardDescription>
                </div>
                <SegmentedControl
                  value={win}
                  onChange={(v) => setWin(v as Win)}
                  options={[
                    { value: '24h', label: '24 часа' },
                    { value: '3d', label: '3 дня' },
                    { value: '7d', label: '7 дней' },
                  ]}
                />
              </div>
            </CardHeader>
            <CardContent>
              {!data.hasHistory ? (
                <div className="text-sm text-ink-3 py-3">История вероятностей недоступна (источник не отдал ряды).</div>
              ) : movers.length ? (
                <div className="-mx-2 divide-y divide-line">
                  {movers.map((m) => <Row key={m.id} m={m} metric="liq" />)}
                </div>
              ) : (
                <div className="text-sm text-ink-3 py-3">За выбранное окно крупных сдвигов (≥3 пп) нет — рынок спокоен.</div>
              )}
            </CardContent>
          </Card>

          {/* КАТЕГОРИИ */}
          <div className="mt-4 flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer select-none">
              <input type="checkbox" checked={onlyMoves} onChange={(e) => setOnlyMoves(e.target.checked)} />
              Показывать только сдвинувшиеся (Δ24ч ≥ 2 пп)
            </label>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {data.categories.map((c) => {
              const mk = onlyMoves
                ? c.markets.filter((m) => m.move && Math.abs(m.move.d24h) >= 0.02)
                : c.markets;
              if (onlyMoves && !mk.length) return null;
              return (
                <Card key={c.key}>
                  <CardHeader>
                    <CardTitle>{c.label}</CardTitle>
                    <CardDescription>{c.desc}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {mk.length ? (
                      <div className="-mx-2 divide-y divide-line">
                        {mk.map((m) => <Row key={m.id} m={m} metric="vol" />)}
                      </div>
                    ) : (
                      <div className="text-sm text-ink-3 py-3">Нет рынков.</div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-ink-3">
        Вероятности — консенсус рынка, не гарантия. «Сдвиг» подсвечивает, где мнение толпы недавно
        изменилось — это повод изучить катализатор, а не сигнал «купить». Используй как слой контекста
        поверх фундаментальной модели.
      </p>
    </main>
  );
}
