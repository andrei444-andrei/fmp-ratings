'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Skeleton, Spinner, Modal, Sparkline } from '@/components/ui';
import type { EventsData, EconEvent, EarningsEvent } from '@/lib/terminal/events';

const HI = '#f43f5e';
const MED = '#f59e0b';
const LOW = '#8b95a7';
const BRAND = '#6d5bf0';
const UP = '#0a8a60';
const DOWN = '#c81e3c';
const IMP_TONE: Record<EconEvent['impact'], string> = { High: HI, Medium: MED, Low: LOW };

type IndicatorInfo = { id: string; title: string; agencyRu: string; agencyEn: string; frequency: string; unit: string; what: string; how: string; why: string; betterWhenHigher: boolean | null };
type HistPoint = { date: string; actual: number | null; estimate: number | null; previous: number | null };
type HistResp = { q: string; info: IndicatorInfo | null; series: HistPoint[]; synthetic: boolean };

export default function EventsCard() {
  const [data, setData] = useState<EventsData | null>(null);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState<EconEvent | null>(null);
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
          <Badge variant="brand">±неделя</Badge>
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
          <Agenda d={data} onPick={setSel} />
        )}
      </div>
      {sel && <DetailModal event={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

// --- helpers ---
const dayKey = (s: string) => s.slice(0, 10);
const todayKey = () => new Date().toISOString().slice(0, 10);
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
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function dayHead(key: string): { wd: string; dm: string } {
  const t = new Date(key + 'T12:00:00');
  if (isNaN(t.getTime())) return { wd: '', dm: key.slice(5) };
  return { wd: WD[t.getDay()], dm: `${t.getDate()}.${t.getMonth() + 1}` };
}
const num = (s: string | number | null | undefined): number | null =>
  s == null || s === '' ? null : Number.isFinite(Number(s)) ? Number(s) : null;
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return String(Math.round(n * 1000) / 1000);
}
type Tone = 'up' | 'down' | 'flat';
function surpriseTone(delta: number, goodHigh: boolean | null | undefined): Tone {
  if (Math.abs(delta) < 1e-9) return 'flat';
  if (goodHigh == null) return 'flat';
  return (goodHigh ? delta > 0 : delta < 0) ? 'up' : 'down';
}
const TONE_HEX: Record<Tone, string> = { up: UP, down: DOWN, flat: '#8b95a7' };

type DayItem =
  | { kind: 'econ'; t: string; e: EconEvent }
  | { kind: 'earn'; t: string; e: EarningsEvent };

function Agenda({ d, onPick }: { d: EventsData; onPick: (e: EconEvent) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const empty = d.econ.length === 0 && d.earnings.length === 0;
  // объединяем макро + отчёты в одну агенду по дням
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
  const tKey = todayKey();
  const todayIdx = days.indexOf(tKey);
  // якорим прокрутку на полную колонку за ~2 дня до сегодня: видны недавние завершённые + сегодня + будущее
  const anchorIdx = todayIdx < 0 ? 0 : Math.max(0, todayIdx - 2);

  // прокручиваем к якорной колонке по её offsetLeft (контейнер relative) — без обрезки и без вертикального скачка
  useEffect(() => {
    const c = scrollRef.current;
    const a = anchorRef.current;
    if (c && a) c.scrollLeft = a.offsetLeft;
  }, [d]);

  if (empty) {
    return <div className="px-2 py-8 text-center text-[12px] text-ink-3">{d.synthetic ? 'Календари недоступны (нет ключа FMP)' : 'Значимых событий не найдено'}</div>;
  }

  return (
    <div ref={scrollRef} className="relative overflow-x-auto">
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(116px, 1fr))` }}>
        {days.map((k, idx) => {
          const items = byDay.get(k)!;
          const hi = items.filter((it) => it.kind === 'econ' && it.e.impact === 'High').length;
          const { wd, dm } = dayHead(k);
          const isToday = k === tKey;
          const isPast = k < tKey;
          return (
            <div key={k} ref={idx === anchorIdx ? anchorRef : undefined} className="min-w-0">
              <div className={`mb-2 flex items-baseline gap-1.5 border-b-2 pb-1.5 ${isToday ? 'border-brand' : 'border-line'}`}>
                <span className={`text-[11px] font-extrabold uppercase tracking-wide ${isToday ? 'text-brand' : 'text-ink-2'}`}>{wd}</span>
                <span className="text-[10px] text-ink-3">{dm}</span>
                {isToday && <span className="rounded-full bg-brand px-1.5 text-[8px] font-bold uppercase leading-[14px] text-white">сег</span>}
                <span className="ml-auto text-[9px] font-bold tabular-nums text-ink-3">{items.length}{hi ? ` · ${hi}●` : ''}</span>
              </div>
              <div className={isPast ? 'opacity-[0.82]' : ''}>
                {items.map((it, i) => (it.kind === 'econ' ? <EconCell key={i} e={it.e} onPick={onPick} /> : <EarnCell key={i} e={it.e} />))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EconCell({ e, onPick }: { e: EconEvent; onPick: (e: EconEvent) => void }) {
  const hi = e.impact === 'High';
  const tone = IMP_TONE[e.impact];
  const est = num(e.estimate);
  const prev = num(e.previous);
  const act = num(e.actual);
  const t = timeOf(e.date);
  const done = act != null;

  let result: React.ReactNode = null;
  if (done) {
    const sTone = est != null ? surpriseTone(act - est, e.goodHigh) : 'flat';
    result = (
      <div className="mt-1">
        <div className="flex items-baseline gap-1 text-[12px] tabular-nums">
          <span className="text-[9.5px] uppercase tracking-wide text-ink-3">факт</span>
          <span className="font-extrabold" style={{ color: TONE_HEX[sTone] }}>{e.actual}</span>
        </div>
        {(est != null || prev != null) && (
          <div className="text-[10px] tabular-nums text-ink-3">{est != null ? `прог ${e.estimate}` : ''}{est != null && prev != null ? ' · ' : ''}{prev != null ? `пред ${e.previous}` : ''}</div>
        )}
      </div>
    );
  } else if (est != null && prev != null) {
    const d = est - prev;
    const cls = d > 1e-9 ? 'text-up-strong' : d < -1e-9 ? 'text-down-strong' : 'text-ink-3';
    const ar = d > 1e-9 ? '↑' : d < -1e-9 ? '↓' : '=';
    result = (
      <div className="mt-1 flex items-center gap-1 text-[10.5px] tabular-nums">
        <span className="text-ink-3">{e.previous}</span>
        <span className={`font-bold ${cls}`}>{ar}</span>
        <span className={`font-semibold ${cls}`}>{e.estimate}</span>
      </div>
    );
  } else if (prev != null) {
    result = <div className="mt-1 text-[10.5px] tabular-nums text-ink-3">пред {e.previous}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onPick(e)}
      className="mb-1.5 block w-full cursor-pointer rounded-fk-sm border border-line px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
      style={{ borderLeft: `3px solid ${tone}`, background: hi ? '#fff7f8' : 'transparent' }}
      title="Подробнее о метрике"
    >
      {t && <div className="text-[10px] font-semibold text-ink-3">{t}</div>}
      <div className={`text-[11.5px] leading-tight ${hi ? 'font-bold text-ink' : 'text-ink-2'}`}>{e.event}</div>
      {result}
    </button>
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

// ---------- детальное окно ----------
function DetailModal({ event, onClose }: { event: EconEvent; onClose: () => void }) {
  const [resp, setResp] = useState<HistResp | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/market/events/history?q=${encodeURIComponent(event.event)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: HistResp) => alive && setResp(d))
      .catch(() => alive && setResp(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [event.event]);

  const info = resp?.info ?? null;
  const goodHigh = info?.betterWhenHigher ?? event.goodHigh ?? null;
  const est = num(event.estimate);
  const prev = num(event.previous);
  const act = num(event.actual);
  const done = act != null;
  const t = new Date((event.date.includes(' ') ? event.date.replace(' ', 'T') : event.date + 'T12:00') + ':00');
  const whenStr = isNaN(t.getTime()) ? event.date : `${WD[t.getDay()]} ${t.getDate()}.${t.getMonth() + 1}${timeOf(event.date) ? ` · ${timeOf(event.date)}` : ''}`;

  const meta = info ? `${info.agencyRu} · ${info.frequency} · ${info.unit}` : `${event.impact === 'High' ? 'High' : 'Medium'} · США`;

  return (
    <Modal open onClose={onClose} size="lg" title={event.event} description={meta}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: event.impact === 'High' ? '#fdeaed' : '#fdf3e0', color: event.impact === 'High' ? '#c2304a' : '#a96a08' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: IMP_TONE[event.impact] }} />{event.impact}
          </span>
          <span className="text-ink-2">{whenStr}</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${done ? 'bg-up-soft text-up-strong' : 'bg-surface-2 text-ink-3'}`}>{done ? 'опубликовано' : 'ожидается'}</span>
        </div>

        {/* плитки */}
        <div className="grid grid-cols-4 gap-2">
          {done ? (
            <>
              <Tile k="Факт" v={fmtNum(act)} strong />
              <Tile k="Прогноз" v={est != null ? fmtNum(est) : '—'} />
              <Tile k="Прошлое" v={prev != null ? fmtNum(prev) : '—'} />
              <SurpriseTile actual={act} estimate={est} goodHigh={goodHigh} />
            </>
          ) : (
            <>
              <Tile k="Прогноз" v={est != null ? fmtNum(est) : '—'} strong />
              <Tile k="Прошлое" v={prev != null ? fmtNum(prev) : '—'} />
              <ChangeTile estimate={est} previous={prev} goodHigh={goodHigh} />
              <Tile k="Статус" v="ждём" />
            </>
          )}
        </div>

        {/* описание */}
        {loading && !info ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-ink-3"><Spinner /> загружаем описание и историю…</div>
        ) : info ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Block title="Что это">{info.what}</Block>
            <Block title="Как считается">{info.how}</Block>
            <Block title="Почему важно">{info.why}</Block>
          </div>
        ) : (
          <div className="rounded-fk-sm border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-3">Подробное описание для этой метрики пока не добавлено — ниже история значений.</div>
        )}

        {/* история */}
        <History resp={resp} loading={loading} goodHigh={goodHigh} unit={info?.unit} />
      </div>
    </Modal>
  );
}

function Tile({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="rounded-fk-sm border border-line bg-surface-2 px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-ink-3">{k}</div>
      <div className={`mt-0.5 tabular-nums ${strong ? 'text-[17px] font-extrabold text-ink' : 'text-[15px] font-bold text-ink-2'}`}>{v}</div>
    </div>
  );
}
function SurpriseTile({ actual, estimate, goodHigh }: { actual: number; estimate: number | null; goodHigh: boolean | null }) {
  if (estimate == null) return <Tile k="Сюрприз" v="—" />;
  const d = actual - estimate;
  const tone = surpriseTone(d, goodHigh);
  return (
    <div className="rounded-fk-sm border border-line px-2.5 py-2" style={{ background: tone === 'up' ? '#e3f7ef' : tone === 'down' ? '#fee7ec' : 'rgba(237,241,247,0.4)' }}>
      <div className="text-[9.5px] uppercase tracking-wide text-ink-3">Сюрприз</div>
      <div className="mt-0.5 text-[17px] font-extrabold tabular-nums" style={{ color: TONE_HEX[tone] }}>{d > 0 ? '+' : ''}{fmtNum(d)}</div>
    </div>
  );
}
function ChangeTile({ estimate, previous, goodHigh }: { estimate: number | null; previous: number | null; goodHigh: boolean | null }) {
  if (estimate == null || previous == null) return <Tile k="Δ к пред." v="—" />;
  const d = estimate - previous;
  const tone = surpriseTone(d, goodHigh);
  return (
    <div className="rounded-fk-sm border border-line bg-surface-2 px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-ink-3">Δ прог−пред</div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums" style={{ color: TONE_HEX[tone] }}>{d > 0 ? '+' : ''}{fmtNum(d)}</div>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-3">{title}</div>
      <div className="text-[12.5px] leading-snug text-ink-2">{children}</div>
    </div>
  );
}

function History({ resp, loading, goodHigh, unit }: { resp: HistResp | null; loading: boolean; goodHigh: boolean | null; unit?: string }) {
  const series = resp?.series ?? [];
  const chrono = [...series].reverse();
  const actuals = chrono.map((p) => p.actual).filter((v): v is number => v != null);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">История значений{unit ? ` · ${unit}` : ''}</div>
        {actuals.length >= 2 && <Sparkline data={actuals} width={150} height={34} />}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-[12px] text-ink-3"><Spinner /> грузим историю…</div>
      ) : series.length === 0 ? (
        <div className="py-3 text-center text-[12px] text-ink-3">{resp?.synthetic ? 'История недоступна (нет ключа FMP)' : 'Прошлых значений не найдено'}</div>
      ) : (
        <div className="max-h-[230px] overflow-auto rounded-fk-sm border border-line">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[9.5px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-2 py-1.5 text-left font-bold">Дата</th>
                <th className="px-2 py-1.5 text-right font-bold">Факт</th>
                <th className="px-2 py-1.5 text-right font-bold">Прог</th>
                <th className="px-2 py-1.5 text-right font-bold">Пред</th>
                <th className="px-2 py-1.5 text-right font-bold">Сюрприз</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p, i) => {
                const sd = p.actual != null && p.estimate != null ? p.actual - p.estimate : null;
                const tone = sd != null ? surpriseTone(sd, goodHigh) : 'flat';
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1.5 text-left tabular-nums text-ink-2">{fmtDate(p.date)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink">{fmtNum(p.actual)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-3">{fmtNum(p.estimate)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-3">{fmtNum(p.previous)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: TONE_HEX[tone] }}>{sd != null ? `${sd > 0 ? '+' : ''}${fmtNum(sd)}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtDate(d: string): string {
  const t = new Date(d + 'T12:00:00');
  if (isNaN(t.getTime())) return d;
  const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${t.getDate()} ${MON[t.getMonth()]} ${String(t.getFullYear()).slice(2)}`;
}
