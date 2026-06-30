import { libsqlClient } from '@/db/client';
import { getFundamentals } from '@/lib/research/fundamentals';
import { fmpGrades, fmpPriceTargetConsensus, fmpStockNews, fmpIncomeStatement, fmpProfile } from '@/lib/fmp';

// Контентный слой «картина акции» для /ticker: грейды sell-side (история действий), консенсус-таргет,
// фундаментал в динамике (квартальные revenue/маржа/EPS), лента новостей. Все коннекторы — кэш-первым
// в libSQL (CREATE TABLE IF NOT EXISTS, created_at), с TTL-меткой; без ключа FMP — graceful (что в кэше).

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
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_income (
    symbol TEXT NOT NULL, date TEXT NOT NULL, period TEXT, revenue REAL, gross_profit REAL,
    operating_income REAL, net_income REAL, eps REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date)
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
        const from = str(g.previousGrade ?? g.priceWhenPosted ?? g.previousGradeText);
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

/* ----------------------------- фундаментал в динамике ----------------------------- */
export type IncomeRow = { date: string; period: string | null; revenue: number | null; grossMargin: number | null; opMargin: number | null; netMargin: number | null; eps: number | null };
export async function getIncome(symbol: string): Promise<IncomeRow[]> {
  await ensureTables();
  const sym = symbol.toUpperCase();
  if (hasKey() && !(await isFresh(sym, 'income', 24 * 3600e3))) {
    try {
      const data: any = await fmpIncomeStatement(sym, 'quarter', 24);
      const arr: any[] = Array.isArray(data) ? data : [];
      const now = new Date().toISOString();
      const stmts = arr.map((s) => {
        const date = String(s.date ?? '').slice(0, 10);
        if (!date) return null;
        return {
          sql: `INSERT INTO ticker_income (symbol,date,period,revenue,gross_profit,operating_income,net_income,eps,created_at) VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(symbol,date) DO UPDATE SET period=excluded.period, revenue=excluded.revenue, gross_profit=excluded.gross_profit, operating_income=excluded.operating_income, net_income=excluded.net_income, eps=excluded.eps`,
          args: [sym, date, str(s.period), num(s.revenue), num(s.grossProfit), num(s.operatingIncome), num(s.netIncome), num(s.eps ?? s.epsdiluted ?? s.epsDiluted), now],
        };
      }).filter(Boolean) as { sql: string; args: any[] }[];
      if (stmts.length) await libsqlClient.batch(stmts);
      await markFetched(sym, 'income');
    } catch { /* graceful */ }
  }
  const res = await libsqlClient.execute({ sql: `SELECT date,period,revenue,gross_profit,operating_income,net_income,eps FROM ticker_income WHERE symbol=? ORDER BY date ASC LIMIT 24`, args: [sym] });
  return res.rows.map((r: any) => {
    const rev = num(r.revenue);
    const m = (x: any) => (rev && num(x) != null ? (num(x) as number) / rev : null);
    return { date: String(r.date), period: r.period != null ? String(r.period) : null, revenue: rev, grossMargin: m(r.gross_profit), opMargin: m(r.operating_income), netMargin: m(r.net_income), eps: num(r.eps) };
  });
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

/* ----------------------------- аггрегатор ----------------------------- */
export type TickerInsight = {
  symbol: string;
  profile: Profile | null;
  grades: GradeRow[];
  target: Target | null;
  income: IncomeRow[];
  news: NewsRow[];
};
export async function getTickerInsight(symbol: string): Promise<TickerInsight> {
  const sym = symbol.toUpperCase().trim();
  const [profile, grades, target, income, news] = await Promise.all([
    getProfile(sym), getGrades(sym), getPriceTarget(sym), getIncome(sym), getNews(sym),
  ]);
  return { symbol: sym, profile, grades, target, income, news };
}
