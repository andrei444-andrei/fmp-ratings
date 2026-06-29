// Радар событий (идея #4): экономический календарь (важные события США) + отчётности
// мегакапов на ближайшую неделю. Источник — FMP economic-calendar / earnings-calendar.
// Snapshot-кэш (§6), graceful: нет ключа → пустые списки + флаг synthetic.
import { fmpEconomicCalendar, fmpEarningsCalendar } from '@/lib/fmp';
import { logAppError } from '@/lib/app-errors';
import { lookupIndicator } from './indicator-info';
import { readSnapshot, writeSnapshot, isFresh } from './store';

const EVENTS_KEY = 'events_v2'; // v2: окно включает завершённые события (прошлые дни) + actual
const HORIZON_DAYS = 8; // вперёд
const PAST_DAYS = 4; // назад — показываем недавно вышедшие (с фактом)

// мегакапы, чьи отчёты двигают рынок — их выделяем в радаре
const MEGA = new Set([
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO', 'JPM', 'V', 'MA',
  'UNH', 'XOM', 'LLY', 'WMT', 'COST', 'NFLX', 'AMD', 'CRM', 'ORCL', 'JNJ', 'HD', 'BAC', 'PG',
]);

export type EconEvent = { date: string; event: string; country: string; impact: 'High' | 'Medium' | 'Low'; estimate: string | null; previous: string | null; actual: string | null; goodHigh?: boolean | null };
export type EarningsEvent = { date: string; symbol: string; epsEstimated: number | null; time: string | null };
export type EventsData = { asOf: string; econ: EconEvent[]; earnings: EarningsEvent[]; synthetic: boolean };

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoDaysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function normImpact(v: any): 'High' | 'Medium' | 'Low' {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('high') || s === '3') return 'High';
  if (s.includes('medium') || s === '2') return 'Medium';
  return 'Low';
}
const numOrNull = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const strOrNull = (v: any): string | null => (v == null || v === '' ? null : String(v));

export async function computeEvents(): Promise<EventsData> {
  const from = isoDaysAgo(PAST_DAYS);
  const to = isoDaysAhead(HORIZON_DAYS);
  let econRaw: any[] = [];
  let earnRaw: any[] = [];
  let ok = false;
  try {
    const [e1, e2] = await Promise.all([fmpEconomicCalendar(from, to), fmpEarningsCalendar(from, to)]);
    econRaw = Array.isArray(e1) ? e1 : [];
    earnRaw = Array.isArray(e2) ? e2 : [];
    ok = true;
  } catch (e: any) {
    await logAppError({ route: '/api/market/events', message: `calendars failed: ${e?.message || e}` });
  }
  if (!ok) {
    return { asOf: from, econ: [], earnings: [], synthetic: true };
  }

  // экономика: США, важность High/Medium, ближайшая неделя
  const econ: EconEvent[] = econRaw
    .filter((r) => {
      const c = String(r?.country ?? '').toUpperCase();
      const imp = normImpact(r?.impact);
      return (c === 'US' || c === 'USA' || c === 'UNITED STATES') && (imp === 'High' || imp === 'Medium');
    })
    .map((r) => {
      const event = String(r?.event ?? '').slice(0, 80);
      return {
        date: String(r?.date ?? '').slice(0, 16),
        event,
        country: 'US' as const,
        impact: normImpact(r?.impact),
        estimate: strOrNull(r?.estimate),
        previous: strOrNull(r?.previous),
        actual: strOrNull(r?.actual),
        goodHigh: lookupIndicator(event)?.betterWhenHigher ?? null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 48);

  // отчёты: только мегакапы, по возрастанию даты
  const seen = new Set<string>();
  const earnings: EarningsEvent[] = earnRaw
    .filter((r) => MEGA.has(String(r?.symbol ?? '').toUpperCase()))
    .map((r) => ({ date: String(r?.date ?? '').slice(0, 10), symbol: String(r?.symbol ?? '').toUpperCase(), epsEstimated: numOrNull(r?.epsEstimated), time: strOrNull(r?.time) }))
    .filter((r) => {
      if (seen.has(r.symbol)) return false;
      seen.add(r.symbol);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  return { asOf: from, econ, earnings, synthetic: false };
}

export async function getEvents(): Promise<EventsData> {
  const cached = await readSnapshot<EventsData>(EVENTS_KEY);
  if (cached && isFresh(cached.refreshedAt)) return cached.payload;
  try {
    const fresh = await computeEvents();
    await writeSnapshot(EVENTS_KEY, fresh, fresh.asOf);
    return fresh;
  } catch (e: any) {
    await logAppError({ route: '/api/market/events', message: e?.message || 'events failed', stack: e?.stack });
    if (cached) return cached.payload;
    throw e;
  }
}
