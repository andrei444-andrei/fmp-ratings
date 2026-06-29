// История значений макро-индикаторов США для детального окна радара событий.
// Тянем economic-calendar за ~14 мес (чанками, чтобы обойти лимиты диапазона),
// фильтруем US + High/Medium, кэшируем снапшотом (§6). Историю конкретной метрики
// получаем фильтром по нормализованному имени (без месяца/квартала в скобках).
import { fmpEconomicCalendar } from '@/lib/fmp';
import { logAppError } from '@/lib/app-errors';
import { readSnapshot, writeSnapshot, isFresh } from './store';

const HIST_KEY = 'econ_hist_v1';

export type HistPoint = { date: string; actual: number | null; estimate: number | null; previous: number | null };
type HistRow = { date: string; event: string; impact: 'High' | 'Medium' | 'Low'; actual: number | null; estimate: number | null; previous: number | null };
type HistData = { rows: HistRow[]; synthetic: boolean };

function isoMonthsAgo(m: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function normImpact(v: any): 'High' | 'Medium' | 'Low' {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('high') || s === '3') return 'High';
  if (s.includes('medium') || s === '2') return 'Medium';
  return 'Low';
}
const numOrNull = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Нормализуем имя события: убираем (Jun)/(May/26)/(Q1) и схлопываем пробелы.
 *  НЕ трогаем MoM/YoY/QoQ — это разные ряды. */
export function normalizeBase(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAll(): Promise<HistRow[]> {
  // три перекрывающих чанка по ~5 мес, конкатенация + дедуп (event+date)
  const ranges: Array<[string, string]> = [
    [isoMonthsAgo(14), isoMonthsAgo(10)],
    [isoMonthsAgo(10), isoMonthsAgo(5)],
    [isoMonthsAgo(5), isoToday()],
  ];
  const chunks = await Promise.all(
    ranges.map(([f, t]) => fmpEconomicCalendar(f, t).catch(() => [] as any[])),
  );
  const seen = new Set<string>();
  const rows: HistRow[] = [];
  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    for (const r of chunk) {
      const c = String(r?.country ?? '').toUpperCase();
      const imp = normImpact(r?.impact);
      if (!(c === 'US' || c === 'USA' || c === 'UNITED STATES')) continue;
      if (!(imp === 'High' || imp === 'Medium')) continue;
      const date = String(r?.date ?? '').slice(0, 16);
      const event = String(r?.event ?? '').slice(0, 90);
      const k = `${date}|${event}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ date, event, impact: imp, actual: numOrNull(r?.actual), estimate: numOrNull(r?.estimate), previous: numOrNull(r?.previous) });
    }
  }
  return rows;
}

async function getHistData(): Promise<HistData> {
  const cached = await readSnapshot<HistData>(HIST_KEY);
  if (cached && isFresh(cached.refreshedAt)) return cached.payload;
  try {
    const rows = await fetchAll();
    const data: HistData = { rows, synthetic: rows.length === 0 };
    await writeSnapshot(HIST_KEY, data, isoToday());
    return data;
  } catch (e: any) {
    await logAppError({ route: '/api/market/events/history', message: e?.message || 'econ history failed', stack: e?.stack });
    if (cached) return cached.payload;
    return { rows: [], synthetic: true };
  }
}

/** Ряд прошлых значений конкретной метрики (по нормализованному имени), от свежих к старым. */
export async function historyFor(eventName: string, limit = 16): Promise<{ series: HistPoint[]; synthetic: boolean }> {
  const base = normalizeBase(eventName);
  if (!base) return { series: [], synthetic: false };
  const data = await getHistData();
  const series = data.rows
    .filter((r) => normalizeBase(r.event) === base)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((r) => ({ date: r.date.slice(0, 10), actual: r.actual, estimate: r.estimate, previous: r.previous }));
  return { series, synthetic: data.synthetic };
}
