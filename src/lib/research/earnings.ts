import { libsqlClient } from '@/db/client';
import { fmpEarnings } from '@/lib/fmp';

// Коннектор отчётностей: квартальный фактический EPS (и выручка) по тикеру — для реконструкции
// исторического trailing P/E (цена ÷ ttm-EPS) в value-бэктесте. Кэш-первым, как dividends.ts.
let ensured = false;
export async function ensureEarningsTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS earnings (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    eps_actual REAL,
    revenue REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date)
  )`);
  // Отметка «по символу уже тянули» — чтобы не дёргать FMP повторно для тикеров без отчётностей.
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS earnings_fetched (
    symbol TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export type EpsRow = { symbol: string; date: string; eps: number; revenue: number | null };

export async function getEarnings(symbols: string[]): Promise<EpsRow[]> {
  await ensureEarningsTable();
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (!syms.length) return [];
  const ph = syms.map(() => '?').join(',');

  const fetched = await libsqlClient.execute({ sql: `SELECT symbol FROM earnings_fetched WHERE symbol IN (${ph})`, args: syms });
  const done = new Set(fetched.rows.map((r) => String((r as any).symbol)));
  const missing = syms.filter((s) => !done.has(s));

  if (missing.length && process.env.FMP_API_KEY) {
    const now = new Date().toISOString();
    // Партиями по 6 — щадим рейт-лимит FMP (как в других коннекторах).
    for (let i = 0; i < missing.length; i += 6) {
      const stmts: { sql: string; args: any[] }[] = [];
      await Promise.all(
        missing.slice(i, i + 6).map(async (sym) => {
          try {
            const data: any = await fmpEarnings(sym);
            const arr: any[] = Array.isArray(data) ? data : data?.historical ?? [];
            for (const d of arr) {
              const date = String(d.date || '');
              const eps = Number(d.epsActual);
              if (date && Number.isFinite(eps)) {
                const rev = Number(d.revenue);
                stmts.push({
                  sql: `INSERT INTO earnings (symbol,date,eps_actual,revenue,created_at) VALUES (?,?,?,?,?)
                        ON CONFLICT(symbol,date) DO UPDATE SET eps_actual=excluded.eps_actual, revenue=excluded.revenue`,
                  args: [sym, date, eps, Number.isFinite(rev) ? rev : null, now],
                });
              }
            }
          } catch {
            /* нет отчётностей/ошибка — всё равно помечаем как fetched ниже */
          }
          stmts.push({ sql: `INSERT INTO earnings_fetched (symbol,created_at) VALUES (?,?) ON CONFLICT(symbol) DO NOTHING`, args: [sym, now] });
        }),
      );
      if (stmts.length) await libsqlClient.batch(stmts);
    }
  }

  const res = await libsqlClient.execute({
    sql: `SELECT symbol,date,eps_actual,revenue FROM earnings WHERE symbol IN (${ph}) ORDER BY date ASC`,
    args: syms,
  });
  return res.rows.map((r) => ({
    symbol: String((r as any).symbol),
    date: String((r as any).date),
    eps: Number((r as any).eps_actual),
    revenue: (r as any).revenue == null ? null : Number((r as any).revenue),
  }));
}
