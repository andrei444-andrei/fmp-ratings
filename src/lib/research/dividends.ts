import { libsqlClient } from '@/db/client';
import { fmpDividends } from '@/lib/fmp';

// Коннектор дивидендов: история выплат по тикеру (для полной доходности).
let ensured = false;
export async function ensureDividendsTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS dividends (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    dividend REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date)
  )`);
  // Отметка «по символу уже тянули» — чтобы не дёргать FMP повторно для тикеров без дивидендов.
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS dividends_fetched (
    symbol TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export type DivRow = { symbol: string; date: string; dividend: number };

export async function getDividends(symbols: string[]): Promise<DivRow[]> {
  await ensureDividendsTable();
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (!syms.length) return [];
  const ph = syms.map(() => '?').join(',');

  const fetched = await libsqlClient.execute({ sql: `SELECT symbol FROM dividends_fetched WHERE symbol IN (${ph})`, args: syms });
  const done = new Set(fetched.rows.map((r) => String((r as any).symbol)));
  const missing = syms.filter((s) => !done.has(s));

  if (missing.length && process.env.FMP_API_KEY) {
    const now = new Date().toISOString();
    const stmts: { sql: string; args: any[] }[] = [];
    await Promise.all(
      missing.map(async (sym) => {
        try {
          const data: any = await fmpDividends(sym);
          const arr: any[] = Array.isArray(data) ? data : data?.historical ?? [];
          for (const d of arr) {
            const date = String(d.date);
            const div = Number(d.adjDividend ?? d.dividend);
            if (date && Number.isFinite(div)) {
              stmts.push({
                sql: `INSERT INTO dividends (symbol,date,dividend,created_at) VALUES (?,?,?,?)
                      ON CONFLICT(symbol,date) DO UPDATE SET dividend=excluded.dividend`,
                args: [sym, date, div, now],
              });
            }
          }
        } catch {
          /* нет дивидендов/ошибка — всё равно помечаем как fetched ниже */
        }
        stmts.push({ sql: `INSERT INTO dividends_fetched (symbol,created_at) VALUES (?,?) ON CONFLICT(symbol) DO NOTHING`, args: [sym, now] });
      }),
    );
    if (stmts.length) await libsqlClient.batch(stmts);
  }

  const res = await libsqlClient.execute({ sql: `SELECT symbol,date,dividend FROM dividends WHERE symbol IN (${ph}) ORDER BY date ASC`, args: syms });
  return res.rows.map((r) => ({ symbol: String((r as any).symbol), date: String((r as any).date), dividend: Number((r as any).dividend) }));
}
