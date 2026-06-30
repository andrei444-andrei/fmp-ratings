// История показателя за несколько лет — для всплывашки по клику на событие радара.
// Макро/ФРС: тянем economic-calendar за HISTORY_YEARS (погодовыми окнами), фильтруем США +
// значимый тип (тот же классификатор, что и радар) → ряд состоявшихся публикаций.
// Отчётности: EPS actual vs estimate по кварталам (fmpEarnings). Snapshot-кэш, graceful.
import { fmpEconomicCalendar, fmpEarnings } from '@/lib/fmp';
import { logAppError } from '@/lib/app-errors';
import { readSnapshot, writeSnapshot } from './store';
import { classify, sigById, dispNum, numOrNull, MEGA, type Fmt } from './radar';

const HIST_KEY = 'indicator_hist_v1';
const HIST_TTL_MS = 12 * 60 * 60 * 1000; // история меняется только при новых публикациях
const HISTORY_YEARS = 5;
const EPS_TTL_MS = 12 * 60 * 60 * 1000;
const epsKey = (s: string) => `indhist_eps_${s}`;

export type SeriesFmt = Fmt | 'usd';
export type HistPoint = { date: string; actual: number | null; forecast: number | null; prev: number | null };
export type IndicatorSeries = {
  kind: 'macro' | 'fed' | 'earnings';
  id: string | null;
  ticker: string | null;
  title: string;
  eng: string | null;
  desc: string;
  unit: string; // человекочитаемая единица для подписи оси
  fmt: SeriesFmt; // токен форматирования для клиента
  goodHigh: boolean | null; // выше = лучше? (для окраски сюрприза)
  points: HistPoint[]; // по возрастанию даты, только состоявшиеся публикации (actual != null)
  hasSeries: boolean;
  synthetic: boolean;
};

function unitOf(fmt: SeriesFmt): string {
  return fmt === 'pct' || fmt === 'rate' ? '%' : fmt === 'k' ? 'тыс.' : fmt === 'index' ? 'индекс' : fmt === 'usd' ? '$' : '';
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Тянет economic-calendar погодовыми окнами (надёжнее одного большого запроса). */
async function fetchEconYearly(years: number): Promise<any[]> {
  const out: any[] = [];
  const today = new Date();
  for (let y = 0; y < years; y++) {
    const to = new Date(Date.UTC(today.getUTCFullYear() - y, today.getUTCMonth(), today.getUTCDate()));
    const from = new Date(to);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    from.setUTCDate(from.getUTCDate() + 1);
    const data = await fmpEconomicCalendar(iso(from), iso(to));
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

type HistMap = Record<string, HistPoint[]>;

/** Собирает истории ВСЕХ значимых макро/ФРС-типов за один проход по многолетнему календарю. */
async function buildAllMacro(): Promise<HistMap> {
  const rows = await fetchEconYearly(HISTORY_YEARS);
  const byId: Record<string, Map<string, HistPoint>> = {};
  for (const r of rows) {
    const c = String(r?.country ?? '').toUpperCase();
    if (!(c === 'US' || c === 'USA' || c === 'UNITED STATES')) continue;
    const t = classify(String(r?.event ?? ''));
    if (!t) continue;
    const a = dispNum(r?.actual, t.fmt);
    if (a == null) continue; // история = только состоявшиеся публикации
    const date = String(r?.date ?? '').slice(0, 10);
    if (!date) continue;
    const m = (byId[t.id] ??= new Map());
    if (!m.has(date)) m.set(date, { date, actual: a, forecast: dispNum(r?.estimate, t.fmt), prev: dispNum(r?.previous, t.fmt) });
  }
  const out: HistMap = {};
  for (const [id, m] of Object.entries(byId)) out[id] = [...m.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  return out;
}

async function getMacroHistories(): Promise<{ map: HistMap; ok: boolean }> {
  const cached = await readSnapshot<HistMap>(HIST_KEY);
  if (cached && Date.now() - cached.refreshedAt < HIST_TTL_MS) return { map: cached.payload, ok: true };
  try {
    const map = await buildAllMacro();
    await writeSnapshot(HIST_KEY, map, iso(new Date()));
    return { map, ok: true };
  } catch (e: any) {
    await logAppError({ route: '/api/market/indicator', message: `macro history failed: ${e?.message || e}`, stack: e?.stack });
    if (cached) return { map: cached.payload, ok: true };
    return { map: {}, ok: false };
  }
}

/** История макро/ФРС-показателя по id значимого типа. null — неизвестный id. */
export async function getIndicatorById(id: string): Promise<IndicatorSeries | null> {
  const sig = sigById(id);
  if (!sig) return null;
  const { map, ok } = await getMacroHistories();
  const points = map[id] ?? [];
  return {
    kind: sig.fed ? 'fed' : 'macro',
    id,
    ticker: null,
    title: sig.ru,
    eng: sig.eng,
    desc: sig.desc,
    unit: unitOf(sig.fmt),
    fmt: sig.fmt,
    goodHigh: sig.goodHigh,
    points,
    hasSeries: points.length > 0,
    synthetic: !ok && points.length === 0,
  };
}

const EPS_DESC =
  'Прибыль на акцию (EPS) — сколько компания заработала на одну акцию за квартал. Её сравнивают с прогнозом аналитиков: выше прогноза (позитивный сюрприз) обычно толкает акцию вверх, ниже — вниз. Точки на графике — квартальные отчёты.';

/** История EPS (факт vs прогноз) по тикеру топ-компании. */
export async function getEarningsBySymbol(symbolRaw: string): Promise<IndicatorSeries> {
  const symbol = String(symbolRaw || '').toUpperCase();
  const meta = MEGA[symbol];
  const title = meta ? `Отчёт ${meta.ru}` : `Отчёт ${symbol}`;
  const base: IndicatorSeries = {
    kind: 'earnings',
    id: null,
    ticker: symbol,
    title,
    eng: 'EPS, $',
    desc: (meta ? meta.note + '. ' : '') + EPS_DESC,
    unit: '$',
    fmt: 'usd',
    goodHigh: true,
    points: [],
    hasSeries: false,
    synthetic: false,
  };
  if (!symbol) return base;
  const cached = await readSnapshot<IndicatorSeries>(epsKey(symbol));
  if (cached && Date.now() - cached.refreshedAt < EPS_TTL_MS) return cached.payload;
  try {
    const rows = await fmpEarnings(symbol);
    const arr = Array.isArray(rows) ? rows : [];
    const pts: HistPoint[] = [];
    for (const r of arr) {
      const actual = numOrNull(r?.epsActual);
      if (actual == null) continue;
      const date = String(r?.date ?? '').slice(0, 10);
      if (!date) continue;
      pts.push({ date, actual: Math.round(actual * 100) / 100, forecast: round2(numOrNull(r?.epsEstimated)), prev: null });
    }
    pts.sort((a, b) => (a.date < b.date ? -1 : 1));
    const series: IndicatorSeries = { ...base, points: pts, hasSeries: pts.length > 0 };
    await writeSnapshot(epsKey(symbol), series, iso(new Date()));
    return series;
  } catch (e: any) {
    await logAppError({ route: '/api/market/indicator', message: `eps ${symbol} failed: ${e?.message || e}` });
    if (cached) return cached.payload;
    return base;
  }
}

function round2(n: number | null): number | null {
  return n == null ? null : Math.round(n * 100) / 100;
}
