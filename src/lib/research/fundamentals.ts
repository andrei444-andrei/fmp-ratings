import { libsqlClient } from '@/db/client';
import { fmpProfile } from '@/lib/fmp';

// Коннектор фундаментала: снимок профиля по тикеру (сектор/индустрия/размер/бета).
let ensured = false;
export async function ensureFundamentalsTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS fundamentals (
    symbol TEXT PRIMARY KEY,
    company TEXT,
    sector TEXT,
    industry TEXT,
    exchange TEXT,
    country TEXT,
    currency TEXT,
    market_cap REAL,
    beta REAL,
    price REAL,
    last_dividend REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export type FundRow = {
  symbol: string;
  company: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  market_cap: number | null;
  beta: number | null;
  price: number | null;
  last_dividend: number | null;
};

const num = (v: any): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: any): string | null => (v != null && v !== '' ? String(v) : null);

function fromRow(r: any): FundRow {
  return {
    symbol: String(r.symbol),
    company: str(r.company),
    sector: str(r.sector),
    industry: str(r.industry),
    exchange: str(r.exchange),
    country: str(r.country),
    currency: str(r.currency),
    market_cap: num(r.market_cap),
    beta: num(r.beta),
    price: num(r.price),
    last_dividend: num(r.last_dividend),
  };
}

export async function getFundamentals(symbols: string[]): Promise<FundRow[]> {
  await ensureFundamentalsTable();
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (!syms.length) return [];
  const ph = syms.map(() => '?').join(',');
  const cached = await libsqlClient.execute({ sql: `SELECT * FROM fundamentals WHERE symbol IN (${ph})`, args: syms });
  const have = new Map<string, any>();
  for (const r of cached.rows) have.set(String((r as any).symbol), r);

  const missing = syms.filter((s) => !have.has(s));
  if (missing.length && process.env.FMP_API_KEY) {
    const now = new Date().toISOString();
    const stmts: { sql: string; args: any[] }[] = [];
    await Promise.all(
      missing.map(async (sym) => {
        try {
          const data: any = await fmpProfile(sym);
          const p = Array.isArray(data) ? data[0] : data;
          if (!p) return;
          const row: FundRow = {
            symbol: sym,
            company: str(p.companyName),
            sector: str(p.sector),
            industry: str(p.industry),
            exchange: str(p.exchange ?? p.exchangeShortName),
            country: str(p.country),
            currency: str(p.currency),
            market_cap: num(p.marketCap ?? p.mktCap),
            beta: num(p.beta),
            price: num(p.price),
            last_dividend: num(p.lastDividend),
          };
          have.set(sym, row);
          stmts.push({
            sql: `INSERT INTO fundamentals (symbol,company,sector,industry,exchange,country,currency,market_cap,beta,price,last_dividend,created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(symbol) DO UPDATE SET company=excluded.company, sector=excluded.sector, industry=excluded.industry,
                    exchange=excluded.exchange, country=excluded.country, currency=excluded.currency, market_cap=excluded.market_cap,
                    beta=excluded.beta, price=excluded.price, last_dividend=excluded.last_dividend`,
            args: [row.symbol, row.company, row.sector, row.industry, row.exchange, row.country, row.currency, row.market_cap, row.beta, row.price, row.last_dividend, now],
          });
        } catch {
          /* профиль недоступен — пропускаем тикер */
        }
      }),
    );
    if (stmts.length) await libsqlClient.batch(stmts);
  }

  return syms.map((s) => have.get(s)).filter(Boolean).map(fromRow);
}
