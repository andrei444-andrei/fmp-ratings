// Радар событий — единая датированная лента: значимые макрорелизы + отчётности топ-компаний.
// Окно [сегодня−62д … сегодня+45д]: прошлое с фактами (actual), будущее с прогнозами.
// Источник — FMP economic-calendar / earnings-calendar. Только ЗНАЧИМЫЕ типы (фильтр шума),
// названия по-русски. Snapshot-кэш (§6), graceful без ключей.
import { fmpEconomicCalendar, fmpEarningsCalendar } from '@/lib/fmp';
import { logAppError } from '@/lib/app-errors';
import { readSnapshot, writeSnapshot } from './store';

const RADAR_KEY = 'radar_v1';
const RADAR_TTL_MS = 30 * 60 * 1000;
const PAST_DAYS = 62;
const FUTURE_DAYS = 45;

type Fmt = 'pct' | 'k' | 'index' | 'rate' | 'raw';
type SigType = {
  id: string;
  ru: string;
  eng: string;
  importance: 1 | 2;
  goodHigh: boolean | null;
  fmt: Fmt;
  fed?: boolean;
  match: string[]; // подстроки англ. названия (нижний регистр); самое длинное совпадение выигрывает
};

// Значимые типы событий (то, что реально двигает рынок). Остальное (региональные индексы ФРБ,
// запасы топлива, жильё, заказы длит. пользования и т.п.) отфильтровывается как шум.
const SIGNIFICANT: SigType[] = [
  { id: 'core_cpi', ru: 'Базовая инфляция', eng: 'Core CPI', importance: 1, goodHigh: false, fmt: 'pct', match: ['core inflation rate', 'core consumer price', 'core cpi'] },
  { id: 'cpi', ru: 'Инфляция', eng: 'CPI', importance: 1, goodHigh: false, fmt: 'pct', match: ['inflation rate', 'consumer price index'] },
  { id: 'core_pce', ru: 'Главная инфляция для ФРС', eng: 'Core PCE', importance: 1, goodHigh: false, fmt: 'pct', match: ['core pce price index', 'core pce'] },
  { id: 'pce', ru: 'Инфляция PCE', eng: 'PCE', importance: 2, goodHigh: false, fmt: 'pct', match: ['pce price index'] },
  { id: 'ppi', ru: 'Цены производителей', eng: 'PPI', importance: 2, goodHigh: false, fmt: 'pct', match: ['producer price index', 'ppi '] },
  { id: 'nfp', ru: 'Новые рабочие места', eng: 'NFP', importance: 1, goodHigh: true, fmt: 'k', match: ['nonfarm payrolls', 'non farm payrolls', 'non-farm payrolls'] },
  { id: 'unemployment', ru: 'Безработица', eng: 'Unemployment', importance: 2, goodHigh: false, fmt: 'pct', match: ['unemployment rate'] },
  { id: 'claims', ru: 'Заявки на пособие', eng: 'Jobless Claims', importance: 2, goodHigh: false, fmt: 'k', match: ['initial jobless claims', 'jobless claims', 'initial claims'] },
  { id: 'avg_earnings', ru: 'Рост зарплат', eng: 'Avg Hourly Earnings', importance: 2, goodHigh: null, fmt: 'pct', match: ['average hourly earnings'] },
  { id: 'fomc_rate', ru: 'Решение ФРС по ставке', eng: 'FOMC', importance: 1, goodHigh: null, fmt: 'rate', fed: true, match: ['fed interest rate decision', 'interest rate decision', 'fomc rate', 'federal funds rate'] },
  { id: 'fomc_minutes', ru: 'Протокол заседания ФРС', eng: 'FOMC Minutes', importance: 2, goodHigh: null, fmt: 'raw', fed: true, match: ['fomc minutes', 'fed minutes'] },
  { id: 'fed_speech', ru: 'Выступление главы ФРС', eng: 'Fed', importance: 2, goodHigh: null, fmt: 'raw', fed: true, match: ['fed chair', 'powell speech', 'powell testimony', 'fed press conference'] },
  { id: 'ism_mfg', ru: 'Деловая активность: промышленность', eng: 'ISM Mfg', importance: 2, goodHigh: true, fmt: 'index', match: ['ism manufacturing pmi'] },
  { id: 'ism_svc', ru: 'Деловая активность: услуги', eng: 'ISM Svc', importance: 2, goodHigh: true, fmt: 'index', match: ['ism services pmi', 'ism non-manufacturing', 'ism non manufacturing'] },
  { id: 'retail', ru: 'Розничные продажи', eng: 'Retail', importance: 2, goodHigh: true, fmt: 'pct', match: ['retail sales'] },
  { id: 'gdp', ru: 'Рост экономики (ВВП)', eng: 'GDP', importance: 1, goodHigh: true, fmt: 'pct', match: ['gdp growth rate', 'gross domestic product'] },
  { id: 'michigan', ru: 'Доверие потребителей (Мичиган)', eng: 'Michigan', importance: 2, goodHigh: true, fmt: 'index', match: ['michigan consumer sentiment'] },
  { id: 'cb_conf', ru: 'Доверие потребителей', eng: 'Conf.', importance: 2, goodHigh: true, fmt: 'index', match: ['cb consumer confidence', 'consumer confidence'] },
];

/** Классифицирует событие FMP: возвращает значимый тип (самое длинное совпадение) либо null. */
function classify(eventName: string): SigType | null {
  const s = String(eventName || '').toLowerCase();
  if (!s) return null;
  let best: SigType | null = null;
  let bestLen = 0;
  for (const t of SIGNIFICANT) {
    for (const m of t.match) {
      if (m && m.length > bestLen && s.includes(m)) {
        best = t;
        bestLen = m.length;
      }
    }
  }
  return best;
}

// Топ-компании, чьи отчёты двигают рынок (ticker → русско-понятная подпись).
const MEGA: Record<string, { ru: string; note: string }> = {
  AAPL: { ru: 'Apple', note: 'Крупнейшая компания — продажи iPhone и сервисов' },
  MSFT: { ru: 'Microsoft', note: 'Облако Azure и ИИ' },
  NVDA: { ru: 'Nvidia', note: 'Чипы для ИИ — событие для всего рынка' },
  AMZN: { ru: 'Amazon', note: 'Облако AWS и розница' },
  GOOGL: { ru: 'Alphabet (Google)', note: 'Реклама и облако/ИИ' },
  GOOG: { ru: 'Alphabet (Google)', note: 'Реклама и облако/ИИ' },
  META: { ru: 'Meta', note: 'Реклама и траты на ИИ' },
  TSLA: { ru: 'Tesla', note: 'Поставки EV и маржа' },
  AVGO: { ru: 'Broadcom', note: 'Чипы и ПО для ИИ' },
  JPM: { ru: 'JPMorgan', note: 'Крупнейший банк — открывает сезон отчётности' },
  BAC: { ru: 'Bank of America', note: 'Картина по кредитам и потребителю' },
  LLY: { ru: 'Eli Lilly', note: 'Лидер фармы (ожирение/диабет)' },
  NFLX: { ru: 'Netflix', note: 'Барометр стриминга' },
  V: { ru: 'Visa', note: 'Объёмы платежей — пульс потребителя' },
  MA: { ru: 'Mastercard', note: 'Объёмы платежей' },
  WMT: { ru: 'Walmart', note: 'Крупнейший ритейлер — спрос потребителя' },
  XOM: { ru: 'ExxonMobil', note: 'Крупнейшая нефтяная' },
  UNH: { ru: 'UnitedHealth', note: 'Крупнейший медстраховщик' },
  ORCL: { ru: 'Oracle', note: 'Облако и ИИ-инфраструктура' },
  AMD: { ru: 'AMD', note: 'Чипы — конкурент Nvidia' },
  CRM: { ru: 'Salesforce', note: 'Корпоративный софт' },
  COST: { ru: 'Costco', note: 'Спрос потребителя' },
};

export type RadarEntry = {
  date: string; // YYYY-MM-DD
  kind: 'macro' | 'fed' | 'earnings';
  nameRu: string;
  eng: string | null;
  rawEvent: string | null; // оригинальное англ. название (для истории по клику)
  importance: 1 | 2;
  actual: string | null;
  forecast: string | null;
  prev: string | null;
  unit: string;
  goodHigh: boolean | null;
  ticker: string | null;
  note: string | null;
};
export type RadarData = { today: string; from: string; to: string; entries: RadarEntry[]; synthetic: boolean };

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
const numOrNull = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Форматирует числовое значение FMP в строку для показа, по типу показателя. */
function fmtVal(v: any, fmt: Fmt): string | null {
  const n = numOrNull(v);
  if (n == null) return null;
  if (fmt === 'pct' || fmt === 'rate') return trimNum(n) + '%';
  if (fmt === 'k') {
    const k = Math.abs(n) >= 10000 ? n / 1000 : n; // 175000→175К, 175→175К
    return trimNum(Math.round(k)) + 'K';
  }
  return trimNum(n); // index / raw
}
function trimNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}
function unitOf(fmt: Fmt): string {
  return fmt === 'pct' ? '%' : fmt === 'k' ? 'тыс.' : fmt === 'index' ? 'индекс' : fmt === 'rate' ? '%' : '';
}

export async function computeRadar(): Promise<RadarData> {
  const from = isoDaysAgo(PAST_DAYS);
  const to = isoDaysAhead(FUTURE_DAYS);
  const today = isoDaysAgo(0);
  let econRaw: any[] = [];
  let earnRaw: any[] = [];
  let ok = false;
  try {
    const [e1, e2] = await Promise.all([fmpEconomicCalendar(from, to), fmpEarningsCalendar(isoDaysAgo(3), to)]);
    econRaw = Array.isArray(e1) ? e1 : [];
    earnRaw = Array.isArray(e2) ? e2 : [];
    ok = true;
  } catch (e: any) {
    await logAppError({ route: '/api/market/radar', message: `calendars failed: ${e?.message || e}` });
  }
  if (!ok) return { today, from, to, entries: [], synthetic: true };

  const entries: RadarEntry[] = [];
  const seen = new Set<string>();
  // макро/ФРС: США + значимый тип
  for (const r of econRaw) {
    const c = String(r?.country ?? '').toUpperCase();
    if (!(c === 'US' || c === 'USA' || c === 'UNITED STATES')) continue;
    const raw = String(r?.event ?? '');
    const t = classify(raw);
    if (!t) continue;
    const date = String(r?.date ?? '').slice(0, 10);
    if (!date) continue;
    const key = `${date}|${t.id}`;
    if (seen.has(key)) continue; // дубликаты (напр. headline+control) — берём первый
    seen.add(key);
    entries.push({
      date,
      kind: t.fed ? 'fed' : 'macro',
      nameRu: t.ru,
      eng: t.eng,
      rawEvent: raw,
      importance: t.importance,
      actual: fmtVal(r?.actual, t.fmt),
      forecast: fmtVal(r?.estimate, t.fmt),
      prev: fmtVal(r?.previous, t.fmt),
      unit: unitOf(t.fmt),
      goodHigh: t.goodHigh,
      ticker: null,
      note: null,
    });
  }
  // отчётности мегакапов
  const seenE = new Set<string>();
  for (const r of earnRaw) {
    const ticker = String(r?.symbol ?? '').toUpperCase();
    const meta = MEGA[ticker];
    if (!meta) continue;
    const date = String(r?.date ?? '').slice(0, 10);
    if (!date || seenE.has(ticker + date)) continue;
    seenE.add(ticker + date);
    entries.push({
      date,
      kind: 'earnings',
      nameRu: `Отчёт ${meta.ru}`,
      eng: null,
      rawEvent: null,
      importance: 1,
      actual: null,
      forecast: null,
      prev: null,
      unit: '',
      goodHigh: null,
      ticker,
      note: meta.note,
    });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.importance - b.importance));
  return { today, from, to, entries, synthetic: false };
}

export async function getRadar(): Promise<RadarData> {
  const cached = await readSnapshot<RadarData>(RADAR_KEY);
  if (cached && Date.now() - cached.refreshedAt < RADAR_TTL_MS) return cached.payload;
  try {
    const fresh = await computeRadar();
    await writeSnapshot(RADAR_KEY, fresh, fresh.today);
    return fresh;
  } catch (e: any) {
    await logAppError({ route: '/api/market/radar', message: e?.message || 'radar failed', stack: e?.stack });
    if (cached) return cached.payload;
    throw e;
  }
}
