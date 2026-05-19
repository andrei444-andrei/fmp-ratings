// Курированный список значимых рыночных событий.
// Используется в /heatmap для маркировки дней. Пользователь может добавлять свои.

export type EventCategory =
  | 'geopolitics' | 'monetary' | 'crisis' | 'pandemic'
  | 'policy' | 'macro' | 'corporate' | 'other';

export type MarketEvent = {
  date: string;           // YYYY-MM-DD
  title: string;          // короткий заголовок (показывается в тултипе)
  category: EventCategory;
  description?: string;   // расширенное описание (опционально)
};

export const EVENT_COLORS: Record<EventCategory, string> = {
  geopolitics: '#dc2626',  // red-600
  monetary:    '#2563eb',  // blue-600
  crisis:      '#9333ea',  // purple-600
  pandemic:    '#ea580c',  // orange-600
  policy:      '#0891b2',  // cyan-600
  macro:       '#16a34a',  // green-600  — CPI, NFP, PMI, GDP
  corporate:   '#db2777',  // pink-600   — крупные M&A, IPO, банкротства
  other:       '#525252',  // neutral-600
};

export const EVENT_LABELS: Record<EventCategory, string> = {
  geopolitics: 'Геополитика',
  monetary:    'Монетарная политика',
  crisis:      'Кризис / крах',
  pandemic:    'Пандемия',
  policy:      'Политика / тарифы',
  macro:       'Макро-данные',
  corporate:   'Корпоративные',
  other:       'Прочее',
};

// Безопасная нормализация категории (на вход — что угодно от AI/пользователя)
export function normalizeCategory(c: any): EventCategory {
  if (typeof c !== 'string') return 'other';
  const k = c.toLowerCase().trim();
  if (k === 'geopolitics' || k === 'geo' || k === 'geopolitical') return 'geopolitics';
  if (k === 'monetary' || k === 'monetary policy' || k === 'fed' || k === 'cb') return 'monetary';
  if (k === 'crisis' || k === 'crash' || k === 'shock') return 'crisis';
  if (k === 'pandemic' || k === 'covid' || k === 'health') return 'pandemic';
  if (k === 'policy' || k === 'tariff' || k === 'tariffs' || k === 'political' || k === 'election') return 'policy';
  if (k === 'macro' || k === 'macro-data' || k === 'macrodata' || k === 'data' || k === 'economic') return 'macro';
  if (k === 'corporate' || k === 'company' || k === 'ma' || k === 'm&a' || k === 'ipo' || k === 'earnings') return 'corporate';
  if (k in EVENT_COLORS) return k as EventCategory;
  return 'other';
}

export const MARKET_EVENTS: MarketEvent[] = [
  // === Геополитика ===
  { date: '2020-01-03', title: 'Удар США по Сулеймани', category: 'geopolitics',
    description: 'Авиаудар США в Багдаде ликвидировал командующего «Кудс» Касема Сулеймани.' },
  { date: '2020-01-08', title: 'Иран бьёт по базам США в Ираке', category: 'geopolitics' },
  { date: '2022-02-24', title: 'Россия вторгается в Украину', category: 'geopolitics' },
  { date: '2023-10-07', title: 'Атака ХАМАС на Израиль', category: 'geopolitics' },
  { date: '2024-04-13', title: 'Иран — прямой ракетный удар по Израилю', category: 'geopolitics',
    description: 'Первая прямая атака Ирана с территории Ирана по Израилю.' },
  { date: '2024-10-01', title: 'Иран — второй массированный удар по Израилю', category: 'geopolitics' },
  { date: '2025-06-13', title: 'Израиль атакует Иран (Rising Lion)', category: 'geopolitics',
    description: 'Удары Израиля по ядерной программе и руководству Ирана.' },
  { date: '2025-06-22', title: 'B-2 США бьют по ядерным объектам Ирана', category: 'geopolitics' },
  { date: '2025-06-23', title: 'Иран бьёт по базе США в Катаре', category: 'geopolitics' },
  { date: '2025-06-24', title: 'Объявлено перемирие Израиль-Иран', category: 'geopolitics' },

  // === Монетарная политика ===
  { date: '2020-03-03', title: 'ФРС: экстренное снижение -50bp', category: 'monetary' },
  { date: '2020-03-15', title: 'ФРС: до 0% + QE без лимита', category: 'monetary' },
  { date: '2021-11-03', title: 'ФРС объявляет tapering', category: 'monetary' },
  { date: '2022-03-16', title: 'ФРС: первый подъём ставки цикла +25bp', category: 'monetary' },
  { date: '2022-06-15', title: 'ФРС: +75bp (первый jumbo-hike)', category: 'monetary' },
  { date: '2022-09-21', title: 'ФРС: +75bp, ястребиная риторика', category: 'monetary' },
  { date: '2023-07-26', title: 'ФРС: последний хайк цикла до 5.25-5.50%', category: 'monetary' },
  { date: '2024-09-18', title: 'ФРС: первый кат -50bp', category: 'monetary' },
  { date: '2024-12-18', title: 'ФРС: ястребиный кат -25bp', category: 'monetary' },

  // === Кризисы / крахи ===
  { date: '2020-02-19', title: 'Пред-COVID пик S&P 500', category: 'crisis' },
  { date: '2020-03-09', title: 'Нефть -25%, circuit breaker', category: 'crisis',
    description: 'Развал OPEC+, нефть рухнула, S&P -7% — первый breaker COVID-обвала.' },
  { date: '2020-03-12', title: 'S&P -9.5%, второй breaker', category: 'crisis' },
  { date: '2020-03-16', title: 'S&P -12%, третий breaker', category: 'crisis' },
  { date: '2020-03-23', title: 'COVID-дно S&P 500', category: 'crisis' },
  { date: '2020-04-20', title: 'Нефть WTI ушла в минус', category: 'crisis' },
  { date: '2021-01-27', title: 'Пик шорт-сквиза GameStop', category: 'crisis' },
  { date: '2022-01-03', title: 'Пик S&P 500 2022 года', category: 'crisis' },
  { date: '2022-10-12', title: 'Локальное дно S&P 500 2022', category: 'crisis' },
  { date: '2023-03-10', title: 'Крах Silicon Valley Bank', category: 'crisis' },
  { date: '2023-03-19', title: 'UBS поглощает Credit Suisse', category: 'crisis' },
  { date: '2023-05-01', title: 'Крах First Republic Bank', category: 'crisis' },
  { date: '2024-08-05', title: 'Yen carry unwind, VIX >65', category: 'crisis',
    description: 'BoJ повысил ставку, иена окрепла, carry-trade развалился, Nikkei -12%.' },

  // === Пандемия ===
  { date: '2020-01-21', title: 'Первый случай COVID в США', category: 'pandemic' },
  { date: '2020-03-11', title: 'ВОЗ объявляет пандемию COVID-19', category: 'pandemic' },
  { date: '2020-11-09', title: 'Pfizer: вакцина эффективна 90%+', category: 'pandemic' },
  { date: '2021-11-26', title: 'Штамм Omicron — обвал рынков', category: 'pandemic' },

  // === Политика / тарифы ===
  { date: '2020-11-07', title: 'Победа Байдена объявлена', category: 'policy' },
  { date: '2022-08-16', title: 'Подписан Inflation Reduction Act', category: 'policy' },
  { date: '2024-11-06', title: 'Победа Трампа на выборах', category: 'policy' },
  { date: '2025-01-20', title: 'Инаугурация Трампа', category: 'policy' },
  { date: '2025-02-01', title: 'Тарифы на Канаду/Мексику/Китай объявлены', category: 'policy' },
  { date: '2025-04-02', title: '«Liberation Day» — взаимные тарифы', category: 'policy',
    description: 'Трамп объявил масштабные взаимные тарифы; обвал рынков на следующие дни.' },
  { date: '2025-04-09', title: '90-дневная пауза по тарифам', category: 'policy',
    description: 'Трамп объявил паузу — S&P +9.5% за день.' },
];

// Группировка событий по дате — для O(1) поиска
export function eventsByDate(events: MarketEvent[]): Record<string, MarketEvent[]> {
  const map: Record<string, MarketEvent[]> = {};
  for (const e of events) {
    (map[e.date] = map[e.date] || []).push(e);
  }
  return map;
}
