'use client';

import { useEffect, useState } from 'react';
import { Badge, Skeleton } from '@/components/ui';
import type { EventsData, EconEvent } from '@/lib/terminal/events';

const IMP_TONE: Record<EconEvent['impact'], string> = { High: '#f43f5e', Medium: '#f59e0b', Low: '#8b95a7' };

export default function EventsCard() {
  const [data, setData] = useState<EventsData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/market/events')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => alive && setData(d))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink">Радар событий</span>
          <Badge variant="brand">неделя</Badge>
        </div>
        <span className="text-[11px] text-ink-3">макро · отчёты</span>
      </div>
      <div className="p-3.5">
        {err ? (
          <div className="px-2 py-10 text-center text-[12px] text-ink-3">Не удалось загрузить события</div>
        ) : !data ? (
          <Skeleton className="h-[220px] w-full rounded-fk" />
        ) : (
          <EventsBody d={data} />
        )}
      </div>
    </div>
  );
}

function whenLabel(s: string): string {
  const iso = s.includes(' ') ? s.replace(' ', 'T') : s + 'T00:00:00';
  const t = new Date(iso + (s.length <= 10 ? '' : ''));
  if (isNaN(t.getTime())) return s.slice(5);
  const wd = t.toLocaleDateString('ru-RU', { weekday: 'short' });
  const hasTime = s.length > 10 && !s.endsWith('00:00');
  return hasTime ? `${wd} ${t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : `${wd} ${t.getUTCDate()}.${t.getUTCMonth() + 1}`;
}

function EventsBody({ d }: { d: EventsData }) {
  const empty = d.econ.length === 0 && d.earnings.length === 0;
  if (empty) {
    return <div className="px-2 py-8 text-center text-[12px] text-ink-3">{d.synthetic ? 'Календари недоступны (нет ключа FMP)' : 'На неделю значимых событий не найдено'}</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
      {/* макро */}
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-3">Макро · США</div>
        <div className="space-y-0.5">
          {d.econ.length === 0 && <div className="py-2 text-[12px] text-ink-3">—</div>}
          {d.econ.map((e, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-line py-1 text-[12px] last:border-0">
              <span className="w-16 shrink-0 text-[11px] font-semibold text-ink-2">{whenLabel(e.date)}</span>
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: IMP_TONE[e.impact] }} title={e.impact} />
              <span className="min-w-0 flex-1 truncate" title={e.event}>{e.event}</span>
              {e.estimate != null && <span className="shrink-0 tabular-nums text-ink-3">прог {e.estimate}</span>}
            </div>
          ))}
        </div>
      </div>
      {/* отчёты */}
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-3">Отчёты мегакапов</div>
        <div className="space-y-0.5">
          {d.earnings.length === 0 && <div className="py-2 text-[12px] text-ink-3">—</div>}
          {d.earnings.map((e, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-line py-1 text-[12px] last:border-0">
              <span className="w-16 shrink-0 text-[11px] font-semibold text-ink-2">{whenLabel(e.date)}</span>
              <span className="h-2 w-2 flex-none rounded-full bg-brand" />
              <b className="min-w-0 flex-1 truncate text-ink">{e.symbol}</b>
              {e.epsEstimated != null && <span className="shrink-0 tabular-nums text-ink-3">EPS≈{e.epsEstimated}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
