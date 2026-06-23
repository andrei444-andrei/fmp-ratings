'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Delta,
  Skeleton,
} from '@/components/ui';

type Market = {
  id: string;
  question: string;
  slug: string;
  prob: number;
  vol: number;
  liq: number;
  spread: number;
  daysLeft: number | null;
  oneDay: number;
  oneWeek: number;
  cats: string[];
};

type Data = {
  fetchedAt: string;
  totalScanned: number;
  groups: { macro: Market[]; megacap: Market[]; index: Market[]; crypto: Market[] };
};

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function probVariant(p: number): 'up' | 'down' | 'warn' | 'neutral' {
  if (p >= 0.66) return 'up';
  if (p <= 0.34) return 'down';
  return 'warn';
}

function pmUrl(slug: string): string {
  return slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com';
}

function MarketRow({ m }: { m: Market }) {
  return (
    <a
      href={pmUrl(m.slug)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-fk px-3 py-2.5 hover:bg-surface-2 transition-colors"
    >
      <Badge variant={probVariant(m.prob)} className="w-14 justify-center tabular-nums">
        {pct(m.prob)}
      </Badge>
      <span className="flex-1 text-sm text-ink truncate">{m.question}</span>
      {m.oneDay !== 0 && <Delta value={m.oneDay * 100} percent decimals={1} size="sm" />}
      <span className="hidden sm:inline text-xs text-ink-3 tabular-nums w-16 text-right">
        {money(m.vol)}
      </span>
      <span className="hidden md:inline text-xs text-ink-3 tabular-nums w-12 text-right">
        {m.daysLeft != null ? `${m.daysLeft}d` : '—'}
      </span>
    </a>
  );
}

function Group({
  title,
  desc,
  markets,
  empty,
}: {
  title: string;
  desc: string;
  markets: Market[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent>
        {markets.length ? (
          <div className="-mx-2 divide-y divide-line">
            {markets.map((m) => (
              <MarketRow key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-ink-3 py-4">{empty}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PolymarketPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/polymarket', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink flex items-center gap-2">
            Polymarket <Badge variant="brand">beta</Badge>
          </h1>
          <p className="mt-1 text-sm text-ink-2 max-w-2xl">
            Подразумеваемые вероятности рынков предсказаний как макро-фон и сигнал относительной
            силы. Не стокпикинг: прямых ликвидных рынков на цену отдельных акций на Polymarket нет —
            ценность в режиме ФРС и в относительной силе мегакапов.
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="secondary">
          {loading ? 'Обновляю…' : 'Обновить'}
        </Button>
      </div>

      {data && (
        <p className="mt-2 text-xs text-ink-3">
          Источник: gamma.polymarket.com · отсканировано {data.totalScanned} активных рынков ·
          обновлено {new Date(data.fetchedAt).toLocaleString('ru-RU')}
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-fk bg-down-soft text-down-strong text-sm px-4 py-3">
          Ошибка: {error}
        </div>
      )}

      {loading && !data && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      )}

      {data && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Group
            title="Режим ФРС"
            desc="Ставки/решения FOMC — фон risk-on/off для всего рынка акций."
            markets={data.groups.macro}
            empty="Нет активных макро-рынков."
          />
          <Group
            title="Относительная сила мегакапов"
            desc="«Largest company by market cap» — прямая ставка, кто обгонит. p = вероятность №1."
            markets={data.groups.megacap}
            empty="Нет активных рынков по мегакапам."
          />
          <Group
            title="Индексы / фондовый рынок"
            desc="Прямые рынки на S&P/Nasdaq/ATH. Ликвидность тонкая — для контекста."
            markets={data.groups.index}
            empty="Нет активных рынков на индексы."
          />
          <Group
            title="Крипто (прокси risk-on)"
            desc="BTC/ETH — косвенный индикатор аппетита к риску, коррелирует с акциями."
            markets={data.groups.crypto}
            empty="Нет активных крипто-рынков."
          />
        </div>
      )}

      <p className="mt-6 text-xs text-ink-3">
        Вероятности — это консенсус рынка, не гарантия. Используй как слой контекста поверх
        фундаментальной модели, а не как самостоятельный сигнал «купить».
      </p>
    </main>
  );
}
