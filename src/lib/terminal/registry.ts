// Сид-вселенная рыночного терминала (чистые данные). Пользовательские блоки/инструменты
// позже наслаиваются из Turso (override), но дефолт живёт здесь и работает без БД.
//
// FX-ИНВАРИАНТ (см. docs §2): eodhdEod отдаёт adjusted_close в НАТИВНОЙ валюте биржи,
// поэтому для блока стран берём ТОЛЬКО US-листинги ETF (EWG/EWJ/INDA/EWZ котируются в USD
// на NYSE Arca) — доходность уже в единой базе USD. Все инструменты сида: currency='USD'.
import type { BlockDef, InstrumentDef } from './types';

export const SEED_INSTRUMENTS: InstrumentDef[] = [
  // Бенчмарки / широкий рынок
  { symbol: 'SPY', title: 'США (S&P 500)', kind: 'etf', currency: 'USD' },
  { symbol: 'ACWI', title: 'Мир (MSCI ACWI)', kind: 'etf', currency: 'USD' },
  // Страны (US-листинги iShares single-country, USD)
  { symbol: 'MCHI', title: 'Китай', kind: 'etf', currency: 'USD' },
  { symbol: 'EWG', title: 'Германия', kind: 'etf', currency: 'USD' },
  { symbol: 'EWJ', title: 'Япония', kind: 'etf', currency: 'USD' },
  { symbol: 'INDA', title: 'Индия', kind: 'etf', currency: 'USD' },
  { symbol: 'EWU', title: 'Великобритания', kind: 'etf', currency: 'USD' },
  { symbol: 'EWZ', title: 'Бразилия', kind: 'etf', currency: 'USD' },
  { symbol: 'EWC', title: 'Канада', kind: 'etf', currency: 'USD' },
  { symbol: 'EWY', title: 'Корея', kind: 'etf', currency: 'USD' },
  { symbol: 'EWW', title: 'Мексика', kind: 'etf', currency: 'USD' },
  // Металлы
  { symbol: 'GLD', title: 'Золото', kind: 'etf', currency: 'USD' },
  { symbol: 'SLV', title: 'Серебро', kind: 'etf', currency: 'USD' },
  { symbol: 'CPER', title: 'Медь', kind: 'etf', currency: 'USD', note: 'фьючерсный, возможен contango' },
  { symbol: 'PPLT', title: 'Платина', kind: 'etf', currency: 'USD' },
  { symbol: 'PALL', title: 'Палладий', kind: 'etf', currency: 'USD', optional: true },
  { symbol: 'GDX', title: 'Золотодобытчики', kind: 'etf', currency: 'USD' },
  { symbol: 'COPX', title: 'Медедобытчики', kind: 'etf', currency: 'USD', optional: true },
  { symbol: 'URA', title: 'Уран', kind: 'etf', currency: 'USD', optional: true },
  // Секторы США (SPDR Select Sector, GICS 11)
  { symbol: 'XLK', title: 'Технологии', kind: 'etf', currency: 'USD' },
  { symbol: 'XLC', title: 'Комм. услуги', kind: 'etf', currency: 'USD' },
  { symbol: 'XLY', title: 'Потреб. цикличный', kind: 'etf', currency: 'USD' },
  { symbol: 'XLF', title: 'Финансы', kind: 'etf', currency: 'USD' },
  { symbol: 'XLI', title: 'Промышленность', kind: 'etf', currency: 'USD' },
  { symbol: 'XLV', title: 'Здравоохранение', kind: 'etf', currency: 'USD' },
  { symbol: 'XLP', title: 'Потреб. защитный', kind: 'etf', currency: 'USD' },
  { symbol: 'XLU', title: 'Коммунальные', kind: 'etf', currency: 'USD' },
  { symbol: 'XLB', title: 'Материалы', kind: 'etf', currency: 'USD' },
  { symbol: 'XLRE', title: 'Недвижимость', kind: 'etf', currency: 'USD' },
  { symbol: 'XLE', title: 'Энергетика', kind: 'etf', currency: 'USD' },
  // Трейд-корзины (ETF-прокси на старте; позже — наборы акций с весами)
  { symbol: 'SMH', title: 'VanEck Semiconductors', kind: 'proxy', currency: 'USD' },
  { symbol: 'SOXX', title: 'iShares Semiconductors', kind: 'proxy', currency: 'USD' },
  { symbol: 'IGV', title: 'Software (iShares Expanded)', kind: 'proxy', currency: 'USD' },
  { symbol: 'BOTZ', title: 'Robotics & AI', kind: 'proxy', currency: 'USD', optional: true },
  { symbol: 'WCLD', title: 'Cloud Software', kind: 'proxy', currency: 'USD', optional: true },
  { symbol: 'NLR', title: 'Nuclear Energy', kind: 'proxy', currency: 'USD', optional: true },
  { symbol: 'ICLN', title: 'Clean Energy', kind: 'proxy', currency: 'USD', optional: true },
  { symbol: 'ITA', title: 'Aerospace & Defense (iShares)', kind: 'proxy', currency: 'USD' },
  { symbol: 'XAR', title: 'Aerospace & Defense (SPDR)', kind: 'proxy', currency: 'USD' },
  { symbol: 'PPA', title: 'Defense & Aerospace (Invesco)', kind: 'proxy', currency: 'USD' },
];

export const SEED_BLOCKS: BlockDef[] = [
  {
    id: 'countries',
    title: 'Страны / ключевые рынки',
    type: 'market',
    benchmark: 'ACWI',
    members: ['SPY', 'MCHI', 'EWG', 'EWJ', 'INDA', 'EWU', 'EWZ', 'EWC', 'EWY', 'EWW'],
    layout: 'table',
  },
  {
    id: 'sectors_us',
    title: 'Секторы экономики США',
    type: 'sector',
    benchmark: 'SPY',
    members: ['XLK', 'XLC', 'XLY', 'XLF', 'XLI', 'XLV', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLE'],
    layout: 'table',
  },
  {
    id: 'metals',
    title: 'Металлы',
    type: 'metal',
    benchmark: '',
    members: ['GLD', 'SLV', 'CPER', 'PPLT', 'PALL', 'GDX', 'COPX', 'URA'],
    layout: 'table',
  },
  { id: 'chips', title: 'Корзина: Чипы / полупроводники', type: 'basket', benchmark: 'SPY', members: ['SMH', 'SOXX'] },
  { id: 'ai_soft', title: 'Корзина: AI-софт', type: 'basket', benchmark: 'SPY', members: ['IGV', 'BOTZ', 'WCLD'] },
  { id: 'power', title: 'Корзина: Электростанции / атом', type: 'basket', benchmark: 'SPY', members: ['XLU', 'URA', 'NLR', 'ICLN'] },
  { id: 'defense', title: 'Корзина: Оборона / оружие', type: 'basket', benchmark: 'SPY', members: ['ITA', 'XAR', 'PPA'] },
];

const BY_SYMBOL = new Map(SEED_INSTRUMENTS.map((i) => [i.symbol, i]));

export function instrumentDef(symbol: string): InstrumentDef | undefined {
  return BY_SYMBOL.get(symbol);
}

/** Все уникальные символы вселенной (включая бенчмарки блоков) — для батч-загрузки цен. */
export function allSymbols(blocks: BlockDef[] = SEED_BLOCKS): string[] {
  const set = new Set<string>();
  for (const b of blocks) {
    for (const m of b.members) set.add(m);
    if (b.benchmark) set.add(b.benchmark);
  }
  return [...set];
}
