import { libsqlClient } from '@/db/client';

// Постоянное хранилище пользовательских КОРЗИН тикеров (вселенных) скринера — в Turso (навсегда).
// Аналогично формулам: единая библиотека, created_at обязателен (§1).

export type BasketRow = { id: string; name: string; tickers: string[] };

const SEP = ',';
const cleanTickers = (xs: any): string[] =>
  [...new Set((Array.isArray(xs) ? xs : String(xs ?? '').split(/[^A-Za-z0-9.\-]+/))
    .map((s: any) => String(s).toUpperCase().trim()).filter(Boolean))].slice(0, 60);

let ensured = false;
export async function ensureBasketsTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS research_baskets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tickers TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

export async function listBaskets(): Promise<BasketRow[]> {
  await ensureBasketsTable();
  const r = await libsqlClient.execute(`SELECT id, name, tickers FROM research_baskets ORDER BY created_at ASC`);
  return (r.rows as any[]).map((x) => ({ id: String(x.id), name: String(x.name), tickers: cleanTickers(String(x.tickers)) }));
}

export async function upsertBasket(b: { id: string; name: string; tickers: string[] }): Promise<void> {
  await ensureBasketsTable();
  const id = String(b.id).slice(0, 80);
  const name = String(b.name).trim().slice(0, 64);
  const tickers = cleanTickers(b.tickers);
  if (!id || !name || !tickers.length) throw new Error('id, name и непустой список тикеров обязательны');
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO research_baskets (id, name, tickers, created_at, updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, tickers=excluded.tickers, updated_at=excluded.updated_at`,
    args: [id, name, tickers.join(SEP), now, now],
  });
}

export async function deleteBasket(id: string): Promise<void> {
  await ensureBasketsTable();
  await libsqlClient.execute({ sql: `DELETE FROM research_baskets WHERE id=?`, args: [String(id)] });
}
