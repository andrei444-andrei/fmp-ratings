import { libsqlClient } from '@/db/client';
import { getFundamentals } from '@/lib/research/fundamentals';
import { fmpGrades, fmpGradesHistorical, fmpPriceTargetConsensus, fmpStockNews, fmpIncomeStatement, fmpRatios, fmpProfile } from '@/lib/fmp';
import { translateMany } from './translate';

// Контентный слой «картина акции» для /ticker: грейды sell-side (лента действий + консенсус во времени),
// консенсус-таргет, фундаментал в динамике (много метрик, длинный формат для графика по любой), лента
// новостей. Описание/новости переводятся на русский (кэш). Кэш-первым в libSQL; без ключа — graceful.

let ensured = false;
async function ensureTables(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_grades (
    symbol TEXT NOT NULL, date TEXT NOT NULL, firm TEXT NOT NULL,
    action TEXT, from_grade TEXT, to_grade TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date, firm)
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_targets (
    symbol TEXT PRIMARY KEY, high REAL, low REAL, consensus REAL, median REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_news (
    symbol TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, site TEXT, url TEXT, snippet TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date, title)
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_consensus (
    symbol TEXT NOT NULL, date TEXT NOT NULL, sb INTEGER, b INTEGER, h INTEGER, s INTEGER, ss INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date)
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_metrics (
    symbol TEXT NOT NULL, date TEXT NOT NULL, key TEXT NOT NULL, value REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date, key)
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_insight_meta (
    symbol TEXT NOT NULL, kind TEXT NOT NULL, fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, kind)
  )`);
  ensured = true;
}
async function isFresh(sym: string, kind: string, ttlMs: number): Promise<boolean> {
  const r = await libsqlClient.execute({ sql: `SELECT fetched_at FROM ticker_insight_meta WHERE symbol=? AND kind=?`, args: [sym, kind] });
  const at = (r.rows[0] as any)?.fetched_at;
  return !!at && Date.now() - Date.parse(String(at)) < ttlMs;
}
async function markFetched(sym: string, kind: string): Promise<void> {
  await libsqlClient.execute({
    sql: `INSERT INTO ticker_insight_meta (symbol,kind,fetched_at) VALUES (?,?,?)
          ON CONFLICT(symbol,kind) DO UPDATE SET fetched_at=excluded.fetched_at`,
    args: [sym, kind, new Date().toISOString()],
  });
}
const num = (v: any): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: any): string | null => (v != null && v !== '' ? String(v) : null);
const hasKey = () => !!process.env.FMP_API_KEY;

/* ----------------------------- грейды (лента действий) ----------------------------- */
export type GradeRow = { date: string; firm: string; action: 'up' | 'down' | 'init' | 'maintain'; from: string | null; to: string | null };
const GRADE_RANK: Record<string, number> = {
  'strong buy': 5, 'buy': 4, 'outperform': 4, 'overweight': 4, 'accumulate': 4, 'add': 4, 'positive': 4,
  'hold': 3, 'neutral': 3, 'equal-weight': 3, 'equalweight': 3, 'market perform': 3, 'in-line': 3, 'sector perform': 3, 'peer perform': 3,
  'underperform': 2, 'underweight': 2, 'sell': 2, 'reduce': 2, 'negative': 2, 'strong sell': 1,
};
function rank(g: string | null): number | null { if (!g) return null; return GRADE_RANK[g.trim().toLowerCase()] ?? null; }
function deriveAction(actionRaw: string | null, from: string | null, to: string | null): GradeRow['action'] {
  const a = (actionRaw || '').toLowerCase();
  if (a.includes('upgrad')) return 'up';
  if (a.includes('downgrad')) return 'down';
  if (a.includes('init')) return 'init';
  if (a.includes('maintain') || a.includes('reiterat')) return 'maintain';
  const rf = rank(from), rt = rank(to);
  if (rf == null && rt != null) return 'init';
  if (rf != null && rt != null) { if (rt > rf) return 'up'; if (rt < rf) return 'down'; }
  return 'maintain';
}
export async function getGrades(symbol: string): Promise<GradeRow[]> {
  await ensureTables();
  const sym = symbol.toUpperCase();
  if (hasKey() && !(await isFresh(sym, 'grades', 12 * 3600e3))) {
    try {
      const data: any = await fmpGrades(sym);
      const arr: any[] = Array.isArray(data) ? data : [];
      const now = new Date().toISOString();
      const stmts = arr.map((g) => {
        const date = String(g.date ?? g.publishedDate ?? '').slice(0, 10);
        const firm = str(g.gradingCompany ?? g.analystCompany ?? g.company) ?? '—';
        const from = str(g.previousGrade ?? g.previousGradeText);
        const to = str(g.newGrade ?? g.newGradeText ?? g.grade);
        const action = deriveAction(str(g.action), from, to);
        return date ? {
          sql: `INSERT INTO ticker_grades (symbol,date,firm,action,from_grade,to_grade,created_at) VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(symbol,date,firm) DO UPDATE SET action=excluded.action, from_grade=excluded.from_grade, to_grade=excluded.to_grade`,
          args: [sym, date, firm, action, from, to, now],
        } : null;
      }).filter(Boolean) as { sql: string; args: any[] }[];
      if (stmts.length) await libsqlClient.batch(stmts);
      await markFetched(sym, 'grades');
    } catch { /* graceful */ }
  }
  const res = await libsqlClient.execute({ sql: `SELECT date,firm,action,from_grade,to_grade FROM ticker_grades WHERE symbol=? ORDER BY date DESC LIMIT 60`, args: [sym] });
  return res.rows.map((r: any) => ({ date: String(r.date), firm: String(r.firm), action: String(r.action) as GradeRow['action'], from: r.from_grade != null ? String(r.from_grade) : null, to: r.to_grade != null ? String(r.to_grade) : null }));
}

/* ----------------------------- консенсус аналитиков во времени ----------------------------- */
export type ConsensusRow = { date: string; sb: number; b: number; h: number; s: number; ss: number };
export async function getConsensus(symbol: string): Promise<ConsensusRow[]> {
  await ensureTables();
  const sym = symbol.toUpperCase();
  if (hasKey() && !(await isFresh(sym, 'consensus', 12 * 3600e3))) {
    try {
      const data: any = await fmpGradesHistorical(sym);
      const arr: any[] = Array.isArray(data) ? data : [];
      const now = new Date().toISOString();
      const stmts = arr.map((c) => {
        const date = String(c.date ?? '').slice(0, 10);
        if (!date) return null;
        const g = (a: any, b: any) => num(a) ?? num(b) ?? 0;
        return {
          sql: `INSERT INTO ticker_consensus (symbol,date,sb,b,h,s,ss,created_at) VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(symbol,date) DO UPDATE SET sb=excluded.sb, b=excluded.b, h=excluded.h, s=excluded.s, ss=excluded.ss`,
          args: [sym, date, g(c.analystRatingsStrongBuy, c.strongBuy), g(c.analystRatingsBuy, c.buy), g(c.analystRatingsHold, c.hold), g(c.analystRatingsSell, c.sell), g(c.analystRatingsStrongSell, c.strongSell), now],
        };
      }).filter(Boolean) as { sql: string; args: any[] }[];
      if (stmts.length) await libsqlClient.batch(stmts);
      await markFetched(sym, 'consensus');
    } catch { /* graceful */ }
  }
  const res = await libsqlClient.execute({ sql: `SELECT date,sb,b,h,s,ss FROM ticker_consensus WHERE symbol=? ORDER BY date ASC LIMIT 60`, args: [sym] });
  return res.rows.map((r: any) => ({ date: String(r.date), sb: Number(r.sb || 0), b: Number(r.b || 0), h: Number(r.h || 0), s: Number(r.s || 0), ss: Number(r.ss || 0) }));
}

/* ----------------------------- консенсус-таргет ----------------------------- */
export type Target = { high: number | null; low: number | null; consensus: number | null; median: number | null };
export async function getPriceTarget(symbol: string): Promise<Target | null> {
  await ensureTables();
  const sym = symbol.toUpperCase();
  if (hasKey() && !(await isFresh(sym, 'target', 12 * 3600e3))) {
    try {
      const data: any = await fmpPriceTargetConsensus(sym);
      const o = Array.isArray(data) ? data[0] : data;
      if (o) {
        await libsqlClient.execute({
          sql: `INSERT INTO ticker_targets (symbol,high,low,consensus,median,created_at) VALUES (?,?,?,?,?,?)
                ON CONFLICT(symbol) DO UPDATE SET high=excluded.high, low=excluded.low, consensus=excluded.consensus, median=excluded.median, created_at=excluded.created_at`,
          args: [sym, num(o.targetHigh), num(o.targetLow), num(o.targetConsensus), num(o.targetMedian), new Date().toISOString()],
        });
      }
      await markFetched(sym, 'target');
    } catch { /* graceful */ }
  }
  const r = await libsqlClient.execute({ sql: `SELECT high,low,consensus,median FROM ticker_targets WHERE symbol=?`, args: [sym] });
  const x = r.rows[0] as any;
  return x ? { high: num(x.high), low: num(x.low), consensus: num(x.consensus), median: num(x.median) } : null;
}

/* ----------------------------- новости ----------------------------- */
export type NewsRow = { date: string; title: string; site: string | null; url: string | null; snippet: string | null };
export async function getNews(symbol: string): Promise<NewsRow[]> {
  await ensureTables();
  const sym = symbol.toUpperCase();
  if (hasKey() && !(await isFresh(sym, 'news', 45 * 60e3))) {
    try {
      const data: any = await fmpStockNews(sym, 40);
      const arr: any[] = Array.isArray(data) ? data : data?.content ?? [];
      const now = new Date().toISOString();
      const stmts = arr.map((nws) => {
        const date = String(nws.publishedDate ?? nws.date ?? '').slice(0, 19).replace(' ', 'T');
        const title = str(nws.title);
        if (!date || !title) return null;
        return {
          sql: `INSERT INTO ticker_news (symbol,date,title,site,url,snippet,created_at) VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(symbol,date,title) DO UPDATE SET site=excluded.site, url=excluded.url, snippet=excluded.snippet`,
          args: [sym, date, title, str(nws.site ?? nws.publisher), str(nws.url), str(nws.text)?.slice(0, 400) ?? null, now],
        };
      }).filter(Boolean) as { sql: string; args: any[] }[];
      if (stmts.length) await libsqlClient.batch(stmts);
      await markFetched(sym, 'news');
    } catch { /* graceful */ }
  }
  const res = await libsqlClient.execute({ sql: `SELECT date,title,site,url,snippet FROM ticker_news WHERE symbol=? ORDER BY date DESC LIMIT 30`, args: [sym] });
  return res.rows.map((r: any) => ({ date: String(r.date), title: String(r.title), site: r.site != null ? String(r.site) : null, url: r.url != null ? String(r.url) : null, snippet: r.snippet != null ? String(r.snippet) : null }));
}

/* ----------------------------- фундаментал: много метрик, график по любой ----------------------------- */
export type MetricUnit = 'usd' | 'pct' | 'x';
export type MetricSeries = { key: string; label: string; group: string; unit: MetricUnit; values: (number | null)[] };
export type FundaData = { dates: string[]; metrics: MetricSeries[] };
const METRIC_DEFS: { key: string; label: string; group: string; unit: MetricUnit }[] = [
  { key: 'revenue', label: 'Выручка', group: 'Доходы', unit: 'usd' },
  { key: 'grossProfit', label: 'Валовая прибыль', group: 'Доходы', unit: 'usd' },
  { key: 'operatingIncome', label: 'Опер. прибыль', group: 'Доходы', unit: 'usd' },
  { key: 'netIncome', label: 'Чистая прибыль', group: 'Доходы', unit: 'usd' },
  { key: 'ebitda', label: 'EBITDA', group: 'Доходы', unit: 'usd' },
  { key: 'eps', label: 'EPS', group: 'Доходы', unit: 'usd' },
  { key: 'rd', label: 'R&D (НИОКР)', group: 'Расходы', unit: 'usd' },
  { key: 'sga', label: 'SG&A', group: 'Расходы', unit: 'usd' },
  { key: 'grossMargin', label: 'Валовая маржа', group: 'Маржа', unit: 'pct' },
  { key: 'opMargin', label: 'Опер. маржа', group: 'Маржа', unit: 'pct' },
  { key: 'netMargin', label: 'Чистая маржа', group: 'Маржа', unit: 'pct' },
  { key: 'roe', label: 'ROE', group: 'Возврат', unit: 'pct' },
  { key: 'roa', label: 'ROA', group: 'Возврат', unit: 'pct' },
  { key: 'roic', label: 'ROIC', group: 'Возврат', unit: 'pct' },
  { key: 'pe', label: 'P/E', group: 'Оценка', unit: 'x' },
  { key: 'ps', label: 'P/S', group: 'Оценка', unit: 'x' },
  { key: 'pb', label: 'P/B', group: 'Оценка', unit: 'x' },
  { key: 'debtEquity', label: 'Долг/капитал', group: 'Долг', unit: 'x' },
  { key: 'currentRatio', label: 'Тек. ликвидность', group: 'Долг', unit: 'x' },
  { key: 'fcfPerShare', label: 'FCF на акцию', group: 'Кэш', unit: 'usd' },
  { key: 'dividendYield', label: 'Див. доходность', group: 'Кэш', unit: 'pct' },
];
export async function getFunda(symbol: string): Promise<FundaData> {
  await ensureTables();
  const sym = symbol.toUpperCase();
  if (hasKey() && !(await isFresh(sym, 'metrics', 24 * 3600e3))) {
    try {
      const [inc, rat]: any[] = await Promise.all([
        fmpIncomeStatement(sym, 'quarter', 24).catch(() => []),
        fmpRatios(sym, 'quarter', 24).catch(() => []),
      ]);
      const now = new Date().toISOString();
      const stmts: { sql: string; args: any[] }[] = [];
      const put = (date: string, key: string, v: number | null) => {
        if (!date || v == null) return;
        stmts.push({ sql: `INSERT INTO ticker_metrics (symbol,date,key,value,created_at) VALUES (?,?,?,?,?) ON CONFLICT(symbol,date,key) DO UPDATE SET value=excluded.value`, args: [sym, date, key, v, now] });
      };
      for (const s of Array.isArray(inc) ? inc : []) {
        const d = String(s.date ?? '').slice(0, 10);
        put(d, 'revenue', num(s.revenue)); put(d, 'grossProfit', num(s.grossProfit)); put(d, 'operatingIncome', num(s.operatingIncome));
        put(d, 'netIncome', num(s.netIncome)); put(d, 'ebitda', num(s.ebitda)); put(d, 'eps', num(s.eps ?? s.epsdiluted ?? s.epsDiluted));
        put(d, 'rd', num(s.researchAndDevelopmentExpenses)); put(d, 'sga', num(s.sellingGeneralAndAdministrativeExpenses));
      }
      for (const s of Array.isArray(rat) ? rat : []) {
        const d = String(s.date ?? '').slice(0, 10);
        put(d, 'grossMargin', num(s.grossProfitMargin)); put(d, 'opMargin', num(s.operatingProfitMargin ?? s.operatingIncomeRatio)); put(d, 'netMargin', num(s.netProfitMargin ?? s.netIncomeRatio));
        put(d, 'roe', num(s.returnOnEquity)); put(d, 'roa', num(s.returnOnAssets)); put(d, 'roic', num(s.returnOnCapitalEmployed ?? s.returnOnInvestedCapital));
        put(d, 'pe', num(s.priceEarningsRatio ?? s.priceToEarningsRatio)); put(d, 'ps', num(s.priceToSalesRatio ?? s.priceSalesRatio)); put(d, 'pb', num(s.priceToBookRatio ?? s.priceBookValueRatio));
        put(d, 'debtEquity', num(s.debtEquityRatio ?? s.debtToEquityRatio ?? s.debtToEquity)); put(d, 'currentRatio', num(s.currentRatio));
        put(d, 'fcfPerShare', num(s.freeCashFlowPerShare)); put(d, 'dividendYield', num(s.dividendYield));
      }
      for (let i = 0; i < stmts.length; i += 200) await libsqlClient.batch(stmts.slice(i, i + 200));
      await markFetched(sym, 'metrics');
    } catch { /* graceful */ }
  }
  const res = await libsqlClient.execute({ sql: `SELECT date,key,value FROM ticker_metrics WHERE symbol=? ORDER BY date ASC`, args: [sym] });
  const byDate = new Map<string, Record<string, number>>();
  for (const r of res.rows as any[]) {
    const d = String(r.date); if (!byDate.has(d)) byDate.set(d, {});
    (byDate.get(d) as Record<string, number>)[String(r.key)] = Number(r.value);
  }
  const dates = [...byDate.keys()].sort().slice(-24);
  const metrics: MetricSeries[] = METRIC_DEFS
    .map((def) => ({ ...def, values: dates.map((d) => { const v = byDate.get(d)?.[def.key]; return v == null || !Number.isFinite(v) ? null : v; }) }))
    .filter((m) => m.values.some((v) => v != null));
  return { dates, metrics };
}

/* ----------------------------- профиль-досье ----------------------------- */
export type Profile = {
  symbol: string; company: string | null; sector: string | null; industry: string | null;
  country: string | null; currency: string | null; exchange: string | null;
  marketCap: number | null; beta: number | null; price: number | null;
  description: string | null; ceo: string | null; employees: number | null; ipoDate: string | null;
  range52w: string | null; website: string | null;
};
async function getProfile(symbol: string): Promise<Profile | null> {
  const sym = symbol.toUpperCase();
  if (hasKey()) {
    try {
      const data: any = await fmpProfile(sym);
      const p = Array.isArray(data) ? data[0] : data;
      if (p) return {
        symbol: sym, company: str(p.companyName), sector: str(p.sector), industry: str(p.industry),
        country: str(p.country), currency: str(p.currency), exchange: str(p.exchangeShortName ?? p.exchange),
        marketCap: num(p.marketCap ?? p.mktCap), beta: num(p.beta), price: num(p.price),
        description: str(p.description), ceo: str(p.ceo), employees: num(p.fullTimeEmployees), ipoDate: str(p.ipoDate),
        range52w: str(p.range), website: str(p.website),
      };
    } catch { /* fall through to cached fundamentals */ }
  }
  const f = await getFundamentals([sym]).catch(() => []);
  const x = f[0];
  return x ? {
    symbol: sym, company: x.company, sector: x.sector, industry: x.industry, country: x.country, currency: x.currency,
    exchange: x.exchange, marketCap: x.market_cap, beta: x.beta, price: x.price,
    description: null, ceo: null, employees: null, ipoDate: null, range52w: null, website: null,
  } : null;
}

/* ----------------------------- аггрегатор (+ перевод описания/новостей) ----------------------------- */
export type TickerInsight = {
  symbol: string;
  profile: Profile | null;
  grades: GradeRow[];
  consensus: ConsensusRow[];
  target: Target | null;
  funda: FundaData;
  news: NewsRow[];
};
export async function getTickerInsight(symbol: string): Promise<TickerInsight> {
  const sym = symbol.toUpperCase().trim();
  const [profile, grades, consensus, target, funda, news] = await Promise.all([
    getProfile(sym), getGrades(sym), getConsensus(sym), getPriceTarget(sym), getFunda(sym), getNews(sym),
  ]);
  // Перевод на русский: описание компании + заголовки/сниппеты новостей (кэш, graceful).
  try {
    const texts: string[] = [];
    if (profile?.description) texts.push(profile.description);
    for (const n of news) { if (n.title) texts.push(n.title); if (n.snippet) texts.push(n.snippet); }
    if (texts.length) {
      const ru = await translateMany(texts);
      if (profile?.description) profile.description = ru.get(profile.description) || profile.description;
      for (const n of news) {
        if (n.title) n.title = ru.get(n.title) || n.title;
        if (n.snippet) n.snippet = ru.get(n.snippet) || n.snippet;
      }
    }
  } catch { /* перевод не обязателен */ }
  return { symbol: sym, profile, grades, consensus, target, funda, news };
}
