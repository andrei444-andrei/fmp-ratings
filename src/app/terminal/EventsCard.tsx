'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Skeleton, Modal } from '@/components/ui';
import type { RadarData, RadarEntry } from '@/lib/terminal/radar';
import type { IndicatorSeries, HistPoint, SeriesFmt } from '@/lib/terminal/indicator-history';

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
  const [detail, setDetail] = useState<RadarEntry | null>(null);

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
          <Timeline data={data} onlyTop={onlyTop} onOpen={setDetail} />
        )}
      </div>
      {detail && <IndicatorModal entry={detail} onClose={() => setDetail(null)} />}
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

// Открывать всплывашку имеет смысл для макро/ФРС (есть id) и отчётностей (есть ticker).
function canOpen(e: RadarEntry): boolean {
  return Boolean(e.id) || e.kind === 'earnings';
}

function Timeline({ data, onlyTop, onOpen }: { data: RadarData; onlyTop: boolean; onOpen: (e: RadarEntry) => void }) {
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
    rows.push(<Row key={`r${i}`} e={e} onOpen={onOpen} />);
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
        <span className="ml-auto text-ink-3">клик — динамика за годы</span>
      </div>
      <div ref={feedRef} className="relative max-h-[440px] overflow-y-auto">
        {rows}
      </div>
    </div>
  );
}

function Row({ e, onOpen }: { e: RadarEntry; onOpen: (e: RadarEntry) => void }) {
  const past = e.actual != null;
  const sp = surprise(e);
  const clickable = canOpen(e);
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

  const inner = (
    <>
      <span className="mt-1 h-2 w-2 rounded-full" style={{ background: dotColor(e) }} />
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold leading-tight text-ink">{e.nameRu} {e.eng && <span className="text-[10px] font-normal text-ink-3">{e.eng}</span>}</div>
        <div className="mt-0.5 text-[10.5px] leading-tight text-ink-3">{meta}</div>
      </div>
      {right}
    </>
  );

  if (!clickable) {
    return <div className="grid grid-cols-[12px_1fr_auto] items-start gap-2.5 border-b border-line px-3.5 py-2 last:border-0">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      title="Показать динамику за годы"
      className="grid w-full grid-cols-[12px_1fr_auto] items-start gap-2.5 border-b border-line px-3.5 py-2 text-left transition-colors last:border-0 hover:bg-brand-50/60 focus:bg-brand-50/60 focus:outline-none"
    >
      {inner}
    </button>
  );
}

// ───────────────────────── Всплывашка: динамика показателя за годы ─────────────────────────

function fmtV(v: number | null, fmt: SeriesFmt): string {
  if (v == null) return '—';
  const s = (Math.round(v * 100) / 100).toString().replace('.', ',');
  if (fmt === 'pct' || fmt === 'rate') return s + '%';
  if (fmt === 'k') return s + 'K';
  if (fmt === 'usd') return '$' + s;
  return s; // index / raw
}

function IndicatorModal({ entry, onClose }: { entry: RadarEntry; onClose: () => void }) {
  const [series, setSeries] = useState<IndicatorSeries | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setSeries(null);
    setErr(false);
    const q = entry.kind === 'earnings' && entry.ticker ? `symbol=${encodeURIComponent(entry.ticker)}` : `id=${encodeURIComponent(entry.id ?? '')}`;
    fetch(`/api/market/indicator?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => alive && setSeries(d))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [entry]);

  const title = (
    <span className="flex flex-wrap items-baseline gap-2">
      <span>{entry.nameRu}</span>
      {entry.eng && <span className="text-sm font-normal text-ink-3">{entry.eng}</span>}
    </span>
  );

  return (
    <Modal open onClose={onClose} size="xl" title={title} description={series?.desc ?? (entry.kind === 'earnings' ? 'Квартальная прибыль на акцию' : undefined)}>
      {err ? (
        <div className="py-10 text-center text-[13px] text-ink-3">Не удалось загрузить историю</div>
      ) : !series ? (
        <div className="flex flex-col gap-3 py-2">
          <Skeleton className="h-[210px] w-full rounded-fk" />
          <Skeleton className="h-[120px] w-full rounded-fk" />
        </div>
      ) : (
        <IndicatorBody s={series} />
      )}
    </Modal>
  );
}

function IndicatorBody({ s }: { s: IndicatorSeries }) {
  const pts = s.points;
  const last = pts.length ? pts[pts.length - 1] : null;
  const vals = pts.map((p) => p.actual).filter((v): v is number => v != null);
  const lo = vals.length ? Math.min(...vals) : null;
  const hi = vals.length ? Math.max(...vals) : null;

  const dir = s.goodHigh == null ? null : s.goodHigh ? 'выше — лучше для экономики/рынка' : 'ниже — лучше (меньше давление)';

  if (!s.hasSeries) {
    return (
      <div className="py-2">
        <div className="rounded-fk border border-line bg-surface px-3 py-6 text-center text-[13px] text-ink-3">
          У этого события нет числового ряда — это качественное событие (выступление / протокол). Выше описано, что это и зачем за ним следят.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 py-1">
      {/* сводка */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile k="Последнее" v={last ? fmtV(last.actual, s.fmt) : '—'} sub={last ? human(last.date) : undefined} strong />
        <StatTile k="Прогноз был" v={last ? fmtV(last.forecast, s.fmt) : '—'} />
        <StatTile k={`Минимум за ${yearsSpan(pts)}`} v={fmtV(lo, s.fmt)} />
        <StatTile k="Максимум" v={fmtV(hi, s.fmt)} />
      </div>
      {dir && <div className="text-[11.5px] text-ink-3">Как читать: {dir}.</div>}

      {/* график */}
      <HistoryChart pts={pts} fmt={s.fmt} goodHigh={s.goodHigh} />

      {/* лог публикаций */}
      <div>
        <div className="mb-1.5 text-[12px] font-bold text-ink">Все публикации ({pts.length})</div>
        <div className="max-h-[230px] overflow-y-auto rounded-fk border border-line">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-bold">Дата</th>
                <th className="px-2.5 py-1.5 text-right font-bold">Факт</th>
                <th className="px-2.5 py-1.5 text-right font-bold">Прогноз</th>
                <th className="px-2.5 py-1.5 text-right font-bold">Сюрприз</th>
              </tr>
            </thead>
            <tbody>
              {[...pts].reverse().map((p, i) => {
                const sp = pointSurprise(p, s.goodHigh);
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2.5 py-1.5 text-left text-ink-2">{human(p.date)}</td>
                    <td className="px-2.5 py-1.5 text-right font-bold tabular-nums text-ink">{fmtV(p.actual, s.fmt)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-ink-3">{fmtV(p.forecast, s.fmt)}</td>
                    <td className="px-2.5 py-1.5 text-right">
                      {sp ? <span className="rounded-fk-pill px-1.5 py-0.5 text-[10px] font-bold" style={{ background: sp.cls === 'up' ? '#e3f7ef' : sp.cls === 'down' ? '#fee7ec' : '#eef1f6', color: TONE[sp.cls] }}>{sp.txt}</span> : <span className="text-ink-3">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {s.synthetic && <div className="mt-2 text-[11px] text-warn-strong">история недоступна (нет ключа) — показаны только текущие события</div>}
      </div>
    </div>
  );
}

function StatTile({ k, v, sub, strong }: { k: string; v: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-fk-sm border border-line bg-surface px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-ink-3">{k}</div>
      <div className={`mt-0.5 tabular-nums ${strong ? 'text-[17px] font-extrabold text-ink' : 'text-[15px] font-bold text-ink'}`}>{v}</div>
      {sub && <div className="text-[10px] text-ink-3">{sub}</div>}
    </div>
  );
}

function pointSurprise(p: HistPoint, goodHigh: boolean | null): Surprise {
  if (p.actual == null || p.forecast == null || goodHigh == null) return null;
  if (Math.abs(p.actual - p.forecast) < 1e-9) return { cls: 'flat', txt: 'как прогноз' };
  const above = p.actual > p.forecast;
  const good = goodHigh ? above : !above;
  return { cls: good ? 'up' : 'down', txt: above ? 'выше' : 'ниже' };
}

function human(d: string): string {
  const t = new Date(d + 'T12:00:00');
  if (isNaN(t.getTime())) return d;
  return `${t.getDate()} ${MON[t.getMonth()]} ${String(t.getFullYear()).slice(2)}`;
}
function yearsSpan(pts: HistPoint[]): string {
  if (pts.length < 2) return 'период';
  const a = new Date(pts[0].date + 'T12:00:00').getFullYear();
  const b = new Date(pts[pts.length - 1].date + 'T12:00:00').getFullYear();
  const n = Math.max(1, b - a);
  return n === 1 ? 'год' : n < 5 ? `${n} года` : `${n} лет`;
}

function HistoryChart({ pts, fmt, goodHigh }: { pts: HistPoint[]; fmt: SeriesFmt; goodHigh: boolean | null }) {
  const W = 620;
  const H = 230;
  const padL = 42;
  const padR = 14;
  const padT = 14;
  const padB = 24;
  const data = pts.filter((p) => p.actual != null) as (HistPoint & { actual: number })[];
  if (data.length < 2) {
    return <div className="rounded-fk border border-line bg-surface py-10 text-center text-[12px] text-ink-3">Мало данных для графика</div>;
  }
  const xs = data.map((p) => new Date(p.date + 'T12:00:00').getTime());
  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  let lo = Math.min(...data.map((p) => p.actual));
  let hi = Math.max(...data.map((p) => p.actual));
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
  lo -= pad;
  hi += pad;
  const X = (t: number) => padL + (maxX === minX ? 0 : ((t - minX) / (maxX - minX)) * (W - padL - padR));
  const Y = (v: number) => padT + (H - padT - padB) - ((v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const path = data.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)} ${Y(p.actual).toFixed(1)}`).join(' ');
  const area = `${path} L${X(maxX).toFixed(1)} ${Y(lo).toFixed(1)} L${X(minX).toFixed(1)} ${Y(lo).toFixed(1)} Z`;
  const last = data[data.length - 1];
  // подписи годов по оси X
  const years: { t: number; y: number }[] = [];
  let seen = -1;
  for (let i = 0; i < data.length; i++) {
    const y = new Date(data[i].date + 'T12:00:00').getFullYear();
    if (y !== seen) {
      years.push({ t: xs[i], y });
      seen = y;
    }
  }
  // сетка Y: 3 уровня
  const ticks = [lo + (hi - lo) * 0.18, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.82];
  const showDots = data.length <= 36;
  const prevVal = data[data.length - 2]?.actual ?? last.actual;
  const lastTone = goodHigh == null ? BRAND : last.actual >= prevVal ? (goodHigh ? UP : DOWN) : goodHigh ? DOWN : UP;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" style={{ maxHeight: 240 }} fontFamily="inherit">
      <defs>
        <linearGradient id="indFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BRAND} stopOpacity="0.16" />
          <stop offset="100%" stopColor={BRAND} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={Y(t).toFixed(1)} y2={Y(t).toFixed(1)} stroke="#eef1f6" />
          <text x={4} y={(Y(t) + 3).toFixed(1)} fontSize="9.5" fill="#8b95a7">{fmtV(Math.round(t * 100) / 100, fmt)}</text>
        </g>
      ))}
      {years.map((yt, k) => (
        <text key={k} x={X(yt.t).toFixed(1)} y={H - 7} fontSize="9.5" fill="#8b95a7" textAnchor={k === 0 ? 'start' : 'middle'}>{yt.y}</text>
      ))}
      <path d={area} fill="url(#indFill)" stroke="none" />
      <path d={path} fill="none" stroke={BRAND} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      {showDots && data.map((p, i) => <circle key={i} cx={X(xs[i]).toFixed(1)} cy={Y(p.actual).toFixed(1)} r={2.2} fill={BRAND} />)}
      <circle cx={X(maxX).toFixed(1)} cy={Y(last.actual).toFixed(1)} r={4} fill={lastTone} stroke="#fff" strokeWidth={1.5} />
      <text x={(X(maxX) - 6).toFixed(1)} y={(Y(last.actual) - 8).toFixed(1)} fontSize="11" fontWeight="700" fill={lastTone} textAnchor="end">{fmtV(last.actual, fmt)}</text>
    </svg>
  );
}
