'use client';

import { useEffect, useState } from 'react';
import { Badge, Skeleton } from '@/components/ui';
import type { EventsData, EconEvent, EarningsEvent } from '@/lib/terminal/events';

const HI = '#f43f5e';
const MED = '#f59e0b';
const LOW = '#8b95a7';
const BRAND = '#6d5bf0';
const IMP_TONE: Record<EconEvent['impact'], string> = { High: HI, Medium: MED, Low: LOW };

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
        <span className="inline-flex items-center gap-2 text-[10px] text-ink-3">
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: HI }} />High</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: MED }} />Medium</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: BRAND }} />отчёт</span>
        </span>
      </div>
      <div className="p-3.5">
        {err ? (
          <div className="px-2 py-10 text-center text-[12px] text-ink-3">Не удалось загрузить события</div>
        ) : !data ? (
          <Skeleton className="h-[220px] w-full rounded-fk" />
        ) : (
          <Agenda d={data} />
        )}
      </div>
    </div>
  );
}

// --- helpers ---
const dayKey = (s: string) => s.slice(0, 10);
function timeOf(s: string): string {
  const hm = s.length > 10 ? s.slice(11, 16) : '';
  return hm && hm !== '00:00' ? hm : '';
}
function earnTimeLabel(t: string | null): string {
  const v = (t ?? '').toLowerCase();
  if (v.includes('bmo') || v.includes('before')) return 'до откр.';
  if (v.includes('amc') || v.includes('after')) return 'после закр.';
  return '';
}
function earnSortKey(t: string | null): string {
  const v = (t ?? '').toLowerCase();
  if (v.includes('bmo') || v.includes('before')) return '08:00';
  if (v.includes('amc') || v.includes('after')) return '16:30';
  return '12:00';
}
function dayHead(key: string): { wd: string; dm: string } {
  const t = new Date(key + 'T12:00:00');
  if (isNaN(t.getTime())) return { wd: '', dm: key.slice(5) };
  return { wd: t.toLocaleDateString('ru-RU', { weekday: 'short' }), dm: `${t.getDate()}.${t.getMonth() + 1}` };
}
const num = (s: string | null): number | null => (s == null || s === '' ? null : Number.isFinite(Number(s)) ? Number(s) : null);

type DayItem =
  | { kind: 'econ'; t: string; e: EconEvent }
  | { kind: 'earn'; t: string; e: EarningsEvent };

function Agenda({ d }: { d: EventsData }) {
  if (d.econ.length === 0 && d.earnings.length === 0) {
    return <div className="px-2 py-8 text-center text-[12px] text-ink-3">{d.synthetic ? 'Календари недоступны (нет ключа FMP)' : 'На неделю значимых событий не найдено'}</div>;
  }
  // объединяем макро + отчёты в одну недельную агенду по дням
  const byDay = new Map<string, DayItem[]>();
  for (const e of d.econ) {
    const k = dayKey(e.date);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ kind: 'econ', t: timeOf(e.date) || '99:99', e });
  }
  for (const e of d.earnings) {
    const k = dayKey(e.date);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ kind: 'earn', t: earnSortKey(e.time), e });
  }
  const days = [...byDay.keys()].sort();
  for (const k of days) byDay.get(k)!.sort((a, b) => a.t.localeCompare(b.t));

  return (
    <div className="overflow-x-auto">
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(112px, 1fr))` }}>
        {days.map((k) => {
          const items = byDay.get(k)!;
          const hi = items.filter((it) => it.kind === 'econ' && it.e.impact === 'High').length;
          const { wd, dm } = dayHead(k);
          return (
            <div key={k} className="min-w-0">
              <div className="mb-2 flex items-baseline gap-1.5 border-b-2 border-line pb-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-ink-2">{wd}</span>
                <span className="text-[10px] text-ink-3">{dm}</span>
                <span className="ml-auto text-[9px] font-bold tabular-nums text-ink-3">{items.length}{hi ? ` · ${hi}●` : ''}</span>
              </div>
              <div>
                {items.map((it, i) => (it.kind === 'econ' ? <EconCell key={i} e={it.e} /> : <EarnCell key={i} e={it.e} />))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EconCell({ e }: { e: EconEvent }) {
  const hi = e.impact === 'High';
  const tone = IMP_TONE[e.impact];
  const est = num(e.estimate);
  const prev = num(e.previous);
  const t = timeOf(e.date);
  let cons: React.ReactNode = null;
  if (est != null && prev != null) {
    const d = est - prev;
    const cls = d > 1e-9 ? 'text-up-strong' : d < -1e-9 ? 'text-down-strong' : 'text-ink-3';
    const ar = d > 1e-9 ? '↑' : d < -1e-9 ? '↓' : '=';
    cons = (
      <div className="mt-1 flex items-center gap-1 text-[10.5px] tabular-nums">
        <span className="text-ink-3">{e.previous}</span>
        <span className={`font-bold ${cls}`}>{ar}</span>
        <span className={`font-semibold ${cls}`}>{e.estimate}</span>
      </div>
    );
  } else if (prev != null) {
    cons = <div className="mt-1 text-[10.5px] tabular-nums text-ink-3">пред {e.previous}</div>;
  }
  return (
    <div className="mb-1.5 rounded-fk-sm border border-line px-2 py-1.5" style={{ borderLeft: `3px solid ${tone}`, background: hi ? '#fff7f8' : 'transparent' }}>
      {t && <div className="text-[10px] font-semibold text-ink-3">{t}</div>}
      <div className={`text-[11.5px] leading-tight ${hi ? 'font-bold text-ink' : 'text-ink-2'}`}>{e.event}</div>
      {cons}
    </div>
  );
}

function EarnCell({ e }: { e: EarningsEvent }) {
  const tl = earnTimeLabel(e.time);
  return (
    <div className="mb-1.5 rounded-fk-sm border border-line px-2 py-1.5" style={{ borderLeft: `3px solid ${BRAND}`, background: '#f6f4fe' }}>
      {tl && <div className="text-[10px] font-semibold text-ink-3">{tl}</div>}
      <div className="text-[11.5px] leading-tight text-ink">
        <b>{e.symbol}</b> <span className="text-ink-3">отчёт</span>
      </div>
      {e.epsEstimated != null && <div className="mt-1 text-[10.5px] tabular-nums text-ink-3">EPS≈{e.epsEstimated}</div>}
    </div>
  );
}
