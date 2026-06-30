'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Skeleton } from '@/components/ui';
import type { RadarData, RadarEntry } from '@/lib/terminal/radar';

const HI = '#f43f5e';
const MED = '#f59e0b';
const BRAND = '#6d5bf0';
const UP = '#0a8a60';
const DOWN = '#c81e3c';
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONF = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export default function EventsCard() {
  const [data, setData] = useState<RadarData | null>(null);
  const [err, setErr] = useState(false);
  const [onlyTop, setOnlyTop] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/market/radar')
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
          <Badge variant="brand">лента</Badge>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-2">
          <input type="checkbox" checked={onlyTop} onChange={(e) => setOnlyTop(e.target.checked)} className="accent-brand" />
          только важное
        </label>
      </div>
      <div className="p-0">
        {err ? (
          <div className="px-2 py-10 text-center text-[12px] text-ink-3">Не удалось загрузить события</div>
        ) : !data ? (
          <div className="p-3.5"><Skeleton className="h-[300px] w-full rounded-fk" /></div>
        ) : (
          <Timeline data={data} onlyTop={onlyTop} />
        )}
      </div>
    </div>
  );
}

const nf = (s: string | null): number | null => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const disp = (s: string | null): string => (s == null ? '—' : s.replace('.', ','));
function dlabel(d: string): string {
  const t = new Date(d + 'T12:00:00');
  if (isNaN(t.getTime())) return d;
  return `${WD[t.getDay()]}, ${t.getDate()} ${MON[t.getMonth()]}`;
}
function monthOf(d: string): number {
  const t = new Date(d + 'T12:00:00');
  return isNaN(t.getTime()) ? 0 : t.getMonth();
}
function dotColor(e: RadarEntry): string {
  if (e.kind === 'earnings' || e.kind === 'fed') return BRAND;
  return e.importance === 1 ? HI : MED;
}
type Surprise = { cls: 'up' | 'down' | 'flat'; txt: string } | null;
function surprise(e: RadarEntry): Surprise {
  const a = nf(e.actual);
  const f = nf(e.forecast);
  if (a == null || f == null || e.goodHigh == null) return null;
  if (Math.abs(a - f) < 1e-9) return { cls: 'flat', txt: 'как прогноз' };
  const above = a > f;
  const good = e.goodHigh ? above : !above;
  return { cls: good ? 'up' : 'down', txt: (above ? 'выше прогноза' : 'ниже прогноза') + ' — ' + (good ? 'лучше' : 'хуже') };
}
const TONE: Record<string, string> = { up: UP, down: DOWN, flat: '#8b95a7' };

function Timeline({ data, onlyTop }: { data: RadarData; onlyTop: boolean }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const { today } = data;

  const list = useMemo(() => {
    return [...data.entries]
      .filter((e) => !onlyTop || e.importance === 1)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.importance - b.importance));
  }, [data.entries, onlyTop]);

  const months = useMemo(() => [...new Set(list.map((e) => monthOf(e.date)))], [list]);
  const curMonth = monthOf(today);

  // прокрутка к «сегодня» при загрузке/смене фильтра
  useEffect(() => {
    const f = feedRef.current;
    if (!f) return;
    const el = f.querySelector('[data-today]') as HTMLElement | null;
    if (el) f.scrollTop = Math.max(0, el.offsetTop - 6);
  }, [list]);

  const scrollToMonth = (m: number) => {
    const f = feedRef.current;
    if (!f) return;
    const el = f.querySelector(`[data-mfirst="${m}"]`) as HTMLElement | null;
    if (el) f.scrollTo({ top: Math.max(0, el.offsetTop - 6), behavior: 'smooth' });
  };

  if (list.length === 0) {
    return <div className="px-2 py-10 text-center text-[12px] text-ink-3">{data.synthetic ? 'Календарь недоступен (нет ключа FMP)' : 'Значимых событий не найдено'}</div>;
  }

  // план рендера: разделитель «сегодня» + заголовки дат + строки
  const rows: React.ReactNode[] = [];
  let lastDate = '';
  let todayInserted = false;
  const seenMonth = new Set<number>();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!todayInserted && e.date >= today) {
      rows.push(
        <div key="today" data-today className="bg-brand px-3.5 py-1.5 text-[11px] font-bold text-white">
          ● Сегодня · {dlabel(today)}
        </div>,
      );
      todayInserted = true;
    }
    if (e.date !== lastDate) {
      const m = monthOf(e.date);
      const first = !seenMonth.has(m);
      seenMonth.add(m);
      rows.push(
        <div key={`d${e.date}`} data-date={e.date} {...(first ? { 'data-mfirst': m } : {})} className="border-b border-line bg-surface-2 px-3.5 py-1.5 text-[11px] font-extrabold text-ink-3">
          {dlabel(e.date)}
        </div>,
      );
      lastDate = e.date;
    }
    rows.push(<Row key={`r${i}`} e={e} />);
  }
  if (!todayInserted) {
    // все события в прошлом — пометим конец
    rows.push(<div key="today-end" data-today className="px-3.5 py-1.5 text-[11px] font-bold text-ink-3">● Сегодня · {dlabel(today)} (свежих публикаций пока нет)</div>);
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line bg-surface px-3.5 py-2">
        {months.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => scrollToMonth(m)}
            className={`shrink-0 rounded-fk-pill border px-2.5 py-1 text-[11px] font-bold transition-colors ${m === curMonth ? 'border-brand bg-brand text-white' : 'border-line bg-surface-elev text-ink-2 hover:border-brand hover:text-brand'}`}
          >
            {MONF[m]}
          </button>
        ))}
        <span className="ml-auto shrink-0 pl-2 text-[10px] text-ink-3">листай к периоду →</span>
      </div>
      <div className="flex items-center gap-3.5 px-3.5 py-1.5 text-[10px] text-ink-3">
        <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ background: HI }} /> высшая важность</span>
        <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ background: MED }} /> важное</span>
        <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ background: BRAND }} /> ФРС / отчёт</span>
      </div>
      <div ref={feedRef} className="relative max-h-[440px] overflow-y-auto">
        {rows}
      </div>
    </div>
  );
}

function Row({ e }: { e: RadarEntry }) {
  const past = e.actual != null;
  const sp = surprise(e);
  let right: React.ReactNode;
  if (e.kind === 'earnings') {
    right = <span className="rounded-fk-pill bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-3">ожидается</span>;
  } else if (e.kind === 'fed' && past) {
    const d = nf(e.actual);
    const p = nf(e.prev);
    const chg = d != null && p != null ? (d < p ? 'снизили ставку' : d > p ? 'повысили ставку' : 'без изменений') : '';
    right = (
      <div className="text-right">
        <div className="text-[15px] font-extrabold tabular-nums text-ink">{disp(e.actual)}</div>
        {chg && <span className="mt-0.5 inline-block rounded-fk-pill bg-down-soft px-1.5 py-0.5 text-[10px] font-bold text-down-strong">{chg}</span>}
      </div>
    );
  } else if (past) {
    right = (
      <div className="text-right">
        <div className="text-[15px] font-extrabold tabular-nums text-ink">{disp(e.actual)}</div>
        {sp && <span className="mt-0.5 inline-block rounded-fk-pill px-1.5 py-0.5 text-[10px] font-bold" style={{ background: sp.cls === 'up' ? '#e3f7ef' : sp.cls === 'down' ? '#fee7ec' : '#eef1f6', color: TONE[sp.cls] }}>{sp.txt}</span>}
      </div>
    );
  } else {
    right = (
      <div className="text-right">
        <div className="text-[13px] font-bold tabular-nums text-ink-2">{e.forecast != null ? disp(e.forecast) : ''}</div>
        <span className="mt-0.5 inline-block rounded-fk-pill bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-3">ожидается</span>
      </div>
    );
  }

  let meta: React.ReactNode = null;
  if (e.kind === 'earnings') {
    meta = (
      <>
        <span className="mr-1.5 inline-block rounded-fk-sm bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">{e.ticker}</span>
        {e.note}
      </>
    );
  } else if (e.kind === 'fed') {
    meta = `${e.note ?? ''}${e.prev ? `${e.note ? ' · ' : ''}было ${disp(e.prev)}` : ''}`;
  } else if (past) {
    meta = e.forecast != null ? `прогноз ${disp(e.forecast)} · прошлое ${disp(e.prev)}` : `прошлое ${disp(e.prev)}`;
  } else {
    meta = `прошлое ${disp(e.prev)}${e.unit ? ` · ${e.unit}` : ''}`;
  }

  return (
    <div className="grid grid-cols-[12px_1fr_auto] items-start gap-2.5 border-b border-line px-3.5 py-2 last:border-0">
      <span className="mt-1 h-2 w-2 rounded-full" style={{ background: dotColor(e) }} />
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold leading-tight text-ink">{e.nameRu} {e.eng && <span className="text-[10px] font-normal text-ink-3">{e.eng}</span>}</div>
        <div className="mt-0.5 text-[10.5px] leading-tight text-ink-3">{meta}</div>
      </div>
      {right}
    </div>
  );
}
