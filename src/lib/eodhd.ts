// Клиент EODHD (eodhd.com): международные данные + СКОРРЕКТИРОВАННЫЕ цены (adjusted_close) +
// составы бирж. Активируется ТОЛЬКО при наличии EODHD_API_KEY; иначе вся система работает на FMP.
// Сетевые функции тонкие, вся логика разбора — в чистых (юнит-тестируемых) парсерах ниже.

const BASE = 'https://eodhd.com/api';

export function hasEodhd(): boolean {
  return !!process.env.EODHD_API_KEY;
}

// ISO-2 страны → код биржи EODHD (суффикс TICKER.CODE). Подтверждено по докам EODHD.
// JP/IN — best-effort (на живом ключе проверить); при ошибке состав падает на FMP-фолбэк.
export const COUNTRY_EXCHANGE: Record<string, string> = {
  US: 'US', GB: 'LSE', DE: 'XETRA', PL: 'WAR', FR: 'PA', KR: 'KO', IN: 'NSE',
  BR: 'SA', CA: 'TO', AU: 'AU', CH: 'SW', TW: 'TW', MX: 'MX', NL: 'AS', JP: 'TSE',
};

// Тикер вселенной → символ EODHD: без точки = US-листинг (.US); с суффиксом — как есть (уже EODHD-форма).
export function toEodhdSymbol(sym: string): string {
  const s = String(sym || '').toUpperCase().trim();
  if (!s) return '';
  return s.includes('.') ? s : `${s}.US`;
}

// Code + биржа → полный символ EODHD (Code уже может содержать суффикс).
export function normSym(code: unknown, exchange: string): string {
  const c = String(code ?? '').toUpperCase().trim();
  if (!c) return '';
  return c.includes('.') ? c : `${c}.${String(exchange || '').toUpperCase()}`;
}

export type EodhdBar = { date: string; close: number; volume: number | null };

// Разбор EOD-ответа: берём adjusted_close (учёт сплитов/дивидендов → чистые цены без «битых баров»).
export function parseEodBars(arr: unknown): EodhdBar[] {
  const a: any[] = Array.isArray(arr) ? arr : [];
  return a
    .map((d) => ({
      date: String(d?.date ?? ''),
      close: Number(d?.adjusted_close ?? d?.close),
      volume: Number.isFinite(Number(d?.volume)) ? Number(d?.volume) : null,
    }))
    .filter((d) => d.date && Number.isFinite(d.close))
    .sort((x, y) => (x.date < y.date ? -1 : 1));
}

// Разбор exchange-symbol-list: берём обыкновенные акции, собираем полный символ.
export function parseExchangeList(arr: unknown, exchange: string): string[] {
  const a: any[] = Array.isArray(arr) ? arr : [];
  const out = a
    .filter((x) => String(x?.Type ?? '').toLowerCase().includes('common'))
    .map((x) => normSym(x?.Code, String(x?.Exchange || exchange)))
    .filter(Boolean);
  return [...new Set(out)];
}

// Разбор ответа screener (ранжирование по капитализации). Берём символ КАК ОТДАЁТ строка
// (с её собственной биржей), НЕ навешивая суффикс запрошенной биржи на ADR/вторичные листинги —
// иначе US-ADR «PBR» превратился бы в фейковый «PBR.SA». Чистку по родной бирже делает вызывающий.
export function parseScreener(json: unknown): string[] {
  const j: any = json;
  const data: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  const out = data
    .map((x) => {
      const code = String(x?.code ?? x?.Code ?? '').toUpperCase().trim();
      if (!code) return '';
      if (code.includes('.')) return code;
      const rowEx = String(x?.exchange ?? x?.Exchange ?? x?.exchange_short_name ?? '').toUpperCase().trim();
      return rowEx ? `${code}.${rowEx}` : code;
    })
    .filter(Boolean);
  return [...new Set(out)];
}

// ISO-страна → РОДНЫЕ суффиксы символов её биржи (то, что реально приходит в тикерах провайдера).
// Проверено по живым составам прода. Цель — отсечь ADR/вторичные листинги и дубли (напр. NSE+BSE),
// которыми и FMP-`country=`, и EODHD-screener засоряют корзину «акций страны».
export const COUNTRY_NATIVE_SUFFIX: Record<string, string[]> = {
  US: ['US'], GB: ['L'], DE: ['DE'], PL: ['WA'], FR: ['PA'], KR: ['KS', 'KQ', 'KO'],
  IN: ['NS'], BR: ['SA'], CA: ['TO'], AU: ['AX'], CH: ['SW'], TW: ['TW', 'TWO'],
  MX: ['MX'], NL: ['AS'], JP: ['T'],
};

// Оставляет только бумаги РОДНОЙ биржи страны (по суффиксу .XX), сохраняя порядок (капитализацию)
// и убирая дубли. Карты нет / после фильтра пусто → возвращаем исходный дедуплицированный список,
// чтобы непредвиденный суффикс провайдера не обнулил рабочую вселенную (без регресса).
export function keepNativeListings(symbols: string[], country: string): string[] {
  const dedup = [...new Set((symbols || []).map((s) => String(s || '').toUpperCase().trim()).filter(Boolean))];
  const suf = COUNTRY_NATIVE_SUFFIX[String(country || '').toUpperCase()];
  if (!suf || !suf.length) return dedup;
  const keep = new Set(suf.map((x) => x.toUpperCase()));
  const native = dedup.filter((s) => {
    const i = s.lastIndexOf('.');
    return i > 0 && keep.has(s.slice(i + 1));
  });
  return native.length ? native : dedup;
}

/** Скорректированные дневные бары из EODHD. Пусто/исключение → вызывающий падает на кэш/FMP. */
export async function eodhdEod(symbol: string, from: string, to: string): Promise<EodhdBar[]> {
  const key = process.env.EODHD_API_KEY;
  const sym = toEodhdSymbol(symbol);
  if (!key || !sym) return [];
  const url = `${BASE}/eod/${encodeURIComponent(sym)}?api_token=${key}&fmt=json&period=d&from=${from}&to=${to}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('eodhd eod ' + r.status);
  return parseEodBars(await r.json());
}

/** Состав биржи: топ-N по капитализации через screener; иначе общий список обыкновенных акций. */
export async function eodhdConstituents(exchange: string, topN: number): Promise<string[]> {
  const key = process.env.EODHD_API_KEY;
  if (!key || !exchange) return [];
  try {
    const filters = encodeURIComponent(JSON.stringify([['exchange', '=', exchange]]));
    const url = `${BASE}/screener?api_token=${key}&sort=market_capitalization.desc&filters=${filters}&limit=${topN}`;
    const r = await fetch(url);
    if (r.ok) {
      const syms = parseScreener(await r.json());
      if (syms.length >= 5) return syms.slice(0, topN);
    }
  } catch {
    /* screener недоступен на тарифе — падаем на полный список */
  }
  const r = await fetch(`${BASE}/exchange-symbol-list/${exchange}?api_token=${key}&fmt=json`);
  if (!r.ok) throw new Error('eodhd exch ' + r.status);
  return parseExchangeList(await r.json(), exchange).slice(0, topN);
}
