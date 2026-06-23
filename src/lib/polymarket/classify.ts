// Классификация рынков Polymarket по релевантности для фондового рынка.
// Шире, чем «кто крупнейшая компания»: макро/ФРС, индексы, мегакапы,
// отдельные компании и корпоративные события, крипто (risk-on), сырьё.

export type CatKey = 'macro' | 'index' | 'megacap' | 'equity' | 'crypto' | 'commodity';

export const CATEGORIES: { key: CatKey; label: string; desc: string }[] = [
  { key: 'macro', label: 'Макро / ФРС', desc: 'Ставки, FOMC, рецессия, инфляция, тарифы, шатдаун — фон risk-on/off для всего рынка.' },
  { key: 'megacap', label: 'Мегакапы — кто №1', desc: '«Largest company by market cap»: прямая ставка на относительную силу гигантов.' },
  { key: 'equity', label: 'Компании и события', desc: 'Отдельные эмитенты: IPO, отчёты, поглощения, банкротства, продукты.' },
  { key: 'index', label: 'Индексы / рынок', desc: 'S&P 500, Nasdaq, Dow, исторические максимумы.' },
  { key: 'commodity', label: 'Сырьё', desc: 'Нефть, золото, газ — инфляционный и циклический сигнал.' },
  { key: 'crypto', label: 'Крипто (risk-on)', desc: 'BTC/ETH/SOL — прокси аппетита к риску, коррелирует с акциями.' },
];

// Известные эмитенты/тикеры — расширяемый список.
const COMPANIES = [
  'nvidia', 'nvda', 'tesla', 'tsla', 'apple', 'aapl', 'microsoft', 'msft', 'amazon', 'amzn',
  'alphabet', 'google', 'googl', 'meta platforms', ' meta ', 'facebook', 'netflix', 'nflx',
  'openai', 'spacex', 'stripe', 'anthropic', 'palantir', 'pltr', ' amd ', 'intel', 'broadcom',
  'avgo', 'coinbase', 'gamestop', ' gme ', 'boeing', 'berkshire', 'robinhood', 'micron',
  'oracle', 'salesforce', ' uber ', 'reddit', 'bytedance', 'tiktok', 'nintendo', ' sony ',
  'samsung', 'tsmc', 'saudi aramco', 'walmart', 'jpmorgan', 'goldman', 'super micro', 'smci',
  'arm holdings', 'snowflake', 'datadog', 'shopify', 'spotify', 'airbnb', 'rivian', 'lucid',
  'ford', 'general motors', 'disney', 'paypal', 'block inc', 'mara', 'microstrategy', 'strategy',
];

const EQUITY_EVENTS = [
  /\bipo\b/i, /\bearnings\b/i, /acquir/i, /\bmerger\b/i, /\bbankrupt/i, /layoffs?/i,
  /stock split/i, /buyback/i, /delist/i, /\bshares?\b/i, /\bstock\b/i, /market cap/i,
  /go public/i, /\bguidance\b/i, /deliveries/i, /\brevenue\b/i,
];

const RX = {
  macro: [
    /\bfed\b/i, /\bfomc\b/i, /interest rate/i, /\brate (cut|hike|decision|increase|decrease)/i,
    /\brecession\b/i, /\binflation\b/i, /\bcpi\b/i, /\bppi\b/i, /\bgdp\b/i, /unemployment/i,
    /jobs report/i, /powell/i, /\bbps\b/i, /basis points/i, /soft landing/i, /yield curve/i,
    /treasury yield/i, /debt ceiling/i, /government shutdown/i, /\btariffs?\b/i, /trade war/i,
    /\bsanctions?\b/i, /jerome/i,
  ],
  index: [
    /s&p\s*500/i, /\bspx\b/i, /\bspy\b/i, /nasdaq/i, /dow jones/i, /\bdjia\b/i, /russell 2000/i,
    /stock market/i, /\bvix\b/i,
  ],
  megacap: [/largest company in the world/i, /second-largest company/i, /\$?\d+\s*trillion (market cap|company|valuation)/i],
  crypto: [/\bbitcoin\b/i, /\bbtc\b/i, /\bethereum\b/i, /\beth\b/i, /\bcrypto\b/i, /\bsolana\b/i, /\bsol\b/i, /\bxrp\b/i, /dogecoin/i],
  commodity: [/\boil\b/i, /\bcrude\b/i, /\bbrent\b/i, /\bwti\b/i, /\bgold\b/i, /\bsilver\b/i, /\bcopper\b/i, /natural gas/i, /gasoline/i],
};

function hasCompany(t: string): boolean {
  const padded = ` ${t} `;
  return COMPANIES.some((c) => padded.includes(c));
}

export function isEquity(q: string): boolean {
  const t = q.toLowerCase();
  return hasCompany(t) || EQUITY_EVENTS.some((r) => r.test(q));
}

// Все подходящие категории (для тегов) и приоритетная (primary) для секции.
export function categoriesOf(question: string): { cats: CatKey[]; primary: CatKey | null } {
  const q = question || '';
  const cats: CatKey[] = [];
  if (RX.macro.some((r) => r.test(q))) cats.push('macro');
  if (RX.megacap.some((r) => r.test(q))) cats.push('megacap');
  if (RX.index.some((r) => r.test(q))) cats.push('index');
  if (RX.commodity.some((r) => r.test(q))) cats.push('commodity');
  if (RX.crypto.some((r) => r.test(q))) cats.push('crypto');
  if (isEquity(q)) cats.push('equity');

  // приоритет: макро → индексы → мегакапы → сырьё → крипто → компании
  const order: CatKey[] = ['macro', 'index', 'megacap', 'commodity', 'crypto', 'equity'];
  const primary = order.find((c) => cats.includes(c)) ?? null;
  return { cats, primary };
}
