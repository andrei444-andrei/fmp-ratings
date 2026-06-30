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

export type Fmt = 'pct' | 'k' | 'index' | 'rate' | 'raw';
export type SigType = {
  id: string;
  ru: string;
  eng: string;
  importance: 1 | 2;
  goodHigh: boolean | null;
  fmt: Fmt;
  fed?: boolean;
  match: string[]; // подстроки англ. названия (нижний регистр); самое длинное совпадение выигрывает
  exclude?: string[]; // если присутствует любая из подстрок — тип НЕ применяется (отсев суб-метрик)
  desc: string; // что это за метрика и как измеряется (простым языком) — для всплывашки по клику
};

// Значимые типы событий (то, что реально двигает рынок). Подстроки `match` нацелены на ОДНУ
// каноническую версию метрики (для инфляции — годовая YoY, для розницы/PPI — месячная MoM),
// `exclude` отсекает суб-метрики и иные шкалы (продолжающие заявки, U-6, индекс-уровень PPI,
// Private NFP, Business Activity, MoM/YoY-двойники). Прочее (региональные ФРБ, запасы топлива,
// жильё и т.п.) просто не матчится и отбрасывается как шум.
const SIGNIFICANT: SigType[] = [
  { id: 'core_cpi', ru: 'Базовая инфляция', eng: 'Core CPI, г/г', importance: 1, goodHigh: false, fmt: 'pct', match: ['core inflation rate yoy', 'core consumer price index yoy'], desc: 'Базовая инфляция (Core CPI) — рост потребительских цен за год без учёта еды и топлива (их цены скачут). Показывает устойчивое подорожание; ФРС смотрит сюда, решая по ставке. Считает Бюро статистики труда США, ежемесячно. Цель ФРС около 2%.' },
  { id: 'cpi', ru: 'Инфляция', eng: 'CPI, г/г', importance: 1, goodHigh: false, fmt: 'pct', match: ['inflation rate yoy', 'consumer price index yoy'], desc: 'Инфляция (CPI) — на сколько за год подорожала потребительская корзина (еда, жильё, транспорт и т.д.). Главный индикатор роста цен. Бюро статистики труда США, ежемесячно. Высокая инфляция — повод держать ставку высокой.' },
  { id: 'core_pce', ru: 'Главная инфляция для ФРС', eng: 'Core PCE, г/г', importance: 1, goodHigh: false, fmt: 'pct', match: ['core pce price index yoy'], desc: 'Core PCE — любимый показатель инфляции у ФРС (расходы потребителей без еды и топлива). Именно по нему ФРС держит цель ~2%. Бюро экономического анализа, ежемесячно.' },
  { id: 'pce', ru: 'Инфляция PCE', eng: 'PCE, г/г', importance: 2, goodHigh: false, fmt: 'pct', match: ['pce price index yoy'], desc: 'PCE — рост цен на товары и услуги, которые реально покупают люди, за год. Шире, чем CPI. Бюро экономического анализа, ежемесячно.' },
  { id: 'ppi', ru: 'Цены производителей', eng: 'PPI, м/м', importance: 2, goodHigh: false, fmt: 'pct', match: ['producer price index mom', 'ppi mom'], exclude: ['ex food', 'ex energy', 'core'], desc: 'Цены производителей (PPI) — на сколько за месяц изменились оптовые цены, по которым продают сами производители. Ранний сигнал будущей инфляции для потребителя. Бюро статистики труда США, ежемесячно.' },
  { id: 'nfp', ru: 'Новые рабочие места', eng: 'NFP', importance: 1, goodHigh: true, fmt: 'k', match: ['nonfarm payrolls', 'non farm payrolls', 'non-farm payrolls'], exclude: ['private'], desc: 'Новые рабочие места (Non-Farm Payrolls) — сколько рабочих мест добавила экономика США за месяц (без сельского хозяйства). Ключевой отчёт по рынку труда, выходит в первую пятницу месяца. Много новых мест — экономика сильна.' },
  { id: 'unemployment', ru: 'Безработица', eng: 'Unemployment', importance: 2, goodHigh: false, fmt: 'pct', match: ['unemployment rate'], exclude: ['u-6', 'u6'], desc: 'Безработица — доля людей без работы среди тех, кто её ищет. Низкая — рынок труда крепкий. Бюро статистики труда США, ежемесячно.' },
  { id: 'claims', ru: 'Заявки на пособие', eng: 'Initial Claims', importance: 2, goodHigh: false, fmt: 'k', match: ['initial jobless claims', 'initial claims'], desc: 'Первичные заявки на пособие по безработице — сколько человек впервые обратились за пособием за неделю. Самый оперативный индикатор рынка труда (выходит каждый четверг). Рост заявок — увольнения усиливаются.' },
  { id: 'avg_earnings', ru: 'Рост зарплат', eng: 'Earnings, г/г', importance: 2, goodHigh: null, fmt: 'pct', match: ['average hourly earnings yoy'], desc: 'Рост зарплат (Average Hourly Earnings) — на сколько за год выросла средняя почасовая оплата. Быстрый рост давит на инфляцию (у людей больше денег на траты). Бюро статистики труда США, ежемесячно.' },
  { id: 'fomc_rate', ru: 'Решение ФРС по ставке', eng: 'FOMC', importance: 1, goodHigh: null, fmt: 'rate', fed: true, match: ['fed interest rate decision', 'interest rate decision', 'federal funds rate'], desc: 'Ключевая процентная ставка ФРС — стоимость денег во всей экономике США. Выше ставка — дороже кредиты, тормозится инфляция и рынки. Решение принимают 8 раз в год на заседаниях FOMC.' },
  { id: 'fomc_minutes', ru: 'Протокол заседания ФРС', eng: 'FOMC Minutes', importance: 2, goodHigh: null, fmt: 'raw', fed: true, match: ['fomc minutes', 'fed minutes'], desc: 'Протокол заседания ФРС — подробная запись обсуждения, выходит через 3 недели после решения по ставке. Рынок ищет в нём намёки на будущие шаги. Числового значения у события нет.' },
  { id: 'fed_speech', ru: 'Выступление главы ФРС', eng: 'Fed', importance: 2, goodHigh: null, fmt: 'raw', fed: true, match: ['fed press conference', 'powell speech', 'fed chair powell', 'powell testimony'], desc: 'Выступление главы ФРС — рынок ловит сигналы о будущей политике по ставке (жёстче или мягче). Числового значения у события нет.' },
  { id: 'ism_mfg', ru: 'Деловая активность: промышленность', eng: 'ISM Mfg', importance: 2, goodHigh: true, fmt: 'index', match: ['ism manufacturing pmi'], exclude: ['prices', 'employment', 'new orders'], desc: 'Деловая активность в промышленности (ISM Manufacturing PMI) — опрос менеджеров по закупкам на заводах. Выше 50 — сектор растёт, ниже 50 — сжимается. Институт ISM, ежемесячно.' },
  { id: 'ism_svc', ru: 'Деловая активность: услуги', eng: 'ISM Svc', importance: 2, goodHigh: true, fmt: 'index', match: ['ism services pmi', 'ism non-manufacturing pmi'], exclude: ['business activity', 'prices', 'employment', 'new orders'], desc: 'Деловая активность в услугах (ISM Services PMI) — то же, что для промышленности, но для сектора услуг (это львиная доля экономики США). Выше 50 — рост. Институт ISM, ежемесячно.' },
  { id: 'retail', ru: 'Розничные продажи', eng: 'Retail, м/м', importance: 2, goodHigh: true, fmt: 'pct', match: ['retail sales mom'], exclude: ['ex auto', 'control'], desc: 'Розничные продажи — на сколько за месяц изменились продажи в магазинах и онлайне. Прямой замер потребительского спроса (это ~⅔ экономики). Бюро переписи США, ежемесячно.' },
  { id: 'gdp', ru: 'Рост экономики (ВВП)', eng: 'GDP', importance: 1, goodHigh: true, fmt: 'pct', match: ['gdp growth rate qoq'], exclude: ['final', 'sales', 'price', '2nd', '3rd'], desc: 'Рост экономики (ВВП) — на сколько вырос объём всей экономики за квартал (в годовом выражении). Главный показатель здоровья экономики. Бюро экономического анализа, ежеквартально.' },
  { id: 'michigan', ru: 'Доверие потребителей (Мичиган)', eng: 'Michigan', importance: 2, goodHigh: true, fmt: 'index', match: ['michigan consumer sentiment'], exclude: ['expectations', 'conditions', 'inflation'], desc: 'Доверие потребителей (индекс Мичиганского университета) — опрос настроений людей. Выше — люди уверены в будущем и готовы тратить. Ежемесячно.' },
  { id: 'cb_conf', ru: 'Доверие потребителей', eng: 'CB Conf.', importance: 2, goodHigh: true, fmt: 'index', match: ['cb consumer confidence'], desc: 'Доверие потребителей (Conference Board) — индекс уверенности, сильнее завязан на рынок труда. Выше — оптимизм и готовность тратить. Ежемесячно.' },
];

/** Поиск значимого типа по id (для слоя истории показателя). */
export function sigById(id: string): SigType | undefined {
  return SIGNIFICANT.find((t) => t.id === id);
}

/** Классифицирует событие FMP: возвращает значимый тип (самое длинное совпадение) либо null.
 *  Тип с непустым exclude пропускается, если в названии есть любая из его подстрок. */
export function classify(eventName: string): SigType | null {
  const s = String(eventName || '').toLowerCase();
  if (!s) return null;
  let best: SigType | null = null;
  let bestLen = 0;
  for (const t of SIGNIFICANT) {
    if (t.exclude && t.exclude.some((x) => s.includes(x))) continue;
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
export const MEGA: Record<string, { ru: string; note: string }> = {
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
  id: string | null; // id значимого типа (для истории по клику); у отчётностей null (есть ticker)
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
export const numOrNull = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Числовое значение в ЕДИНИЦАХ показа (для графика истории): для 'k' нормализует к тысячам
 *  (175000→175, 175→175), для процентов/индекса — округляет. Согласовано с fmtVal. */
export function dispNum(v: any, fmt: Fmt): number | null {
  const n = numOrNull(v);
  if (n == null) return null;
  if (fmt === 'k') return Math.round(Math.abs(n) >= 10000 ? n / 1000 : n);
  return Math.round(n * 100) / 100;
}

/** Форматирует числовое значение FMP в строку для показа, по типу показателя. */
export function fmtVal(v: any, fmt: Fmt): string | null {
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
      id: t.id,
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
      id: null,
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

  // Прошедшие события без факта (actual) «зависают» как «ожидается» — это вводит в заблуждение
  // (напр. выступление ФРС/отчёт уже состоялись, а числа нет). Такие из прошлого исключаем;
  // будущее (date >= today) и прошлое с фактом — оставляем.
  const clean = entries.filter((e) => e.date >= today || e.actual != null);

  clean.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.importance - b.importance));
  return { today, from, to, entries: clean, synthetic: false };
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
