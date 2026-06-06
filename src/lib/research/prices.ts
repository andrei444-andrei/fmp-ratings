import { libsqlClient } from '@/db/client';
import { fmpHistoricalPriceEod } from '@/lib/fmp';

// Коннектор «база с ценами по тикерам»: кэш-таблица в libSQL, доливаемая из FMP
// on-demand (§ выбран пользователем). created_at обязателен (§1).
let ensured = false;
export async function ensurePricesTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS prices (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    close REAL,
    volume REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, date)
  )`);
  ensured = true;
}

export type PriceRow = { date: string; close: number };

/** Возвращает дневные close за период. Сначала кэш; если пусто — тянет из FMP и кэширует. Без ключа FMP — []. */
export async function getPrices(symbol: string, from: string, to: string): Promise<PriceRow[]> {
  await ensurePricesTable();
  const sym = symbol.toUpperCase();

  const cached = await libsqlClient.execute({
    sql: `SELECT date, close FROM prices WHERE symbol=? AND date>=? AND date<=? AND close IS NOT NULL ORDER BY date ASC`,
    args: [sym, from, to],
  });
  if (cached.rows.length > 5) {
    return cached.rows.map((r) => ({ date: String(r.date), close: Number(r.close) }));
  }

  if (!process.env.FMP_API_KEY) return [];
  try {
    const data: any = await fmpHistoricalPriceEod(sym, from, to);
    const arr: any[] = Array.isArray(data) ? data : data?.historical ?? [];
    const rows = arr
      .map((d) => ({ date: String(d.date), close: Number(d.price ?? d.close ?? d.adjClose) }))
      .filter((d) => d.date && Number.isFinite(d.close));
    if (!rows.length) return [];
    const now = new Date().toISOString();
    // батч-вставка чанками, чтобы не делать сотни round-trip
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const placeholders = slice.map(() => `(?,?,?,?,?)`).join(',');
      const args: any[] = [];
      for (const r of slice) args.push(sym, r.date, r.close, null, now);
      await libsqlClient.execute({
        sql: `INSERT INTO prices (symbol,date,close,volume,created_at) VALUES ${placeholders}
              ON CONFLICT(symbol,date) DO UPDATE SET close=excluded.close`,
        args,
      });
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    return rows;
  } catch {
    return [];
  }
}
