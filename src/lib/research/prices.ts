import { libsqlClient } from '@/db/client';
import { fmpHistoricalPriceEod } from '@/lib/fmp';
import { hasEodhd, eodhdEod } from '@/lib/eodhd';

// Коннектор «база с ценами по тикерам»: кэш-таблица в libSQL, доливаемая из FMP.
// Покрытие на тикер (price_meta) решает, ходить ли в FMP: один раз скачали — дальше отдаём из БД,
// освежая только ХВОСТ. Раньше окно проверялось «есть ли данные за 25 лет» — для бумаг с IPO позже
// это всегда ложно, и мы заново тянули/переписывали всю историю каждый прогон. created_at обязателен (§1).
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
  // Покрытие: до какого from уже запрашивали, по какую дату есть данные, когда освежали, и КАКОЙ
  // провайдер (fmp/eodhd). Цены провайдеров по-разному скорректированы — смешивать историю нельзя.
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS price_meta (
    symbol TEXT PRIMARY KEY,
    fetched_from TEXT NOT NULL,
    last_date TEXT NOT NULL,
    refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  try {
    await libsqlClient.execute(`ALTER TABLE price_meta ADD COLUMN provider TEXT`);
  } catch {
    /* колонка уже есть */
  }
  ensured = true;
}

export type PriceRow = { date: string; close: number; volume: number | null };

const REFRESH_TTL_MS = 12 * 3600 * 1000; // освежаем хвост не чаще раза в ~12ч (EOD-данные)

type Meta = { fetched_from: string; last_date: string; refreshed_at: string; provider: string };

async function readMeta(sym: string): Promise<Meta | null> {
  const r = await libsqlClient.execute({ sql: `SELECT fetched_from, last_date, refreshed_at, provider FROM price_meta WHERE symbol=?`, args: [sym] });
  const x = r.rows[0] as any;
  return x
    ? { fetched_from: String(x.fetched_from), last_date: String(x.last_date), refreshed_at: String(x.refreshed_at), provider: x.provider ? String(x.provider) : 'fmp' }
    : null;
}

async function writeMeta(sym: string, fetchedFrom: string, lastDate: string, provider: string): Promise<void> {
  await libsqlClient.execute({
    sql: `INSERT INTO price_meta (symbol, fetched_from, last_date, refreshed_at, provider) VALUES (?,?,?,?,?)
          ON CONFLICT(symbol) DO UPDATE SET fetched_from=excluded.fetched_from, last_date=excluded.last_date, refreshed_at=excluded.refreshed_at, provider=excluded.provider`,
    args: [sym, fetchedFrom, lastDate, new Date().toISOString(), provider],
  });
}

async function selectRange(sym: string, from: string, to: string): Promise<PriceRow[]> {
  const r = await libsqlClient.execute({
    sql: `SELECT date, close, volume FROM prices WHERE symbol=? AND date>=? AND date<=? AND close IS NOT NULL ORDER BY date ASC`,
    args: [sym, from, to],
  });
  return r.rows.map((x) => ({ date: String(x.date), close: Number(x.close), volume: x.volume != null ? Number(x.volume) : null }));
}

async function upsertRows(sym: string, rows: PriceRow[]): Promise<void> {
  const CHUNK = 100;
  const stmts: { sql: string; args: any[] }[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const placeholders = slice.map(() => `(?,?,?,?,?)`).join(',');
    const args: any[] = [];
    const now = new Date().toISOString();
    for (const r of slice) args.push(sym, r.date, r.close, r.volume, now);
    stmts.push({
      sql: `INSERT INTO prices (symbol,date,close,volume,created_at) VALUES ${placeholders}
            ON CONFLICT(symbol,date) DO UPDATE SET close=excluded.close, volume=excluded.volume`,
      args,
    });
  }
  if (stmts.length) await libsqlClient.batch(stmts);
}

async function fetchFromFmp(sym: string, from: string, to: string): Promise<PriceRow[]> {
  const data: any = await fmpHistoricalPriceEod(sym, from, to);
  const arr: any[] = Array.isArray(data) ? data : data?.historical ?? [];
  return arr
    .map((d) => ({
      date: String(d.date),
      close: Number(d.price ?? d.close ?? d.adjClose),
      volume: Number.isFinite(Number(d.volume)) ? Number(d.volume) : null,
    }))
    .filter((d) => d.date && Number.isFinite(d.close))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Провайдер цен: EODHD (скорректированные цены, широкое гео) при наличии ключа, иначе FMP.
function priceProvider(): { name: string; fetch: (sym: string, from: string, to: string) => Promise<PriceRow[]> } | null {
  if (hasEodhd()) return { name: 'eodhd', fetch: eodhdEod };
  if (process.env.FMP_API_KEY) return { name: 'fmp', fetch: fetchFromFmp };
  return null;
}

/** Возвращает дневные close+volume за период. Кэш-первым; в FMP идём только если тикер не покрыт
 *  с нужного начала ИЛИ устарел — и тогда доливаем только хвост [last_date..to]. */
export async function getPrices(symbol: string, from: string, to: string): Promise<PriceRow[]> {
  await ensurePricesTable();
  const sym = symbol.toUpperCase();
  const provider = priceProvider();

  let meta = await readMeta(sym);
  // Бутстрап покрытия из легаси-данных (таблица prices без price_meta): считаем, что их тянули с тем же
  // окном (роут давно использует фиксированный from) провайдером FMP, чтобы не перекачивать заново.
  if (!meta) {
    const mm = await libsqlClient.execute({ sql: `SELECT MIN(date) AS lo, MAX(date) AS hi FROM prices WHERE symbol=? AND close IS NOT NULL`, args: [sym] });
    const lo = (mm.rows[0] as any)?.lo;
    const hi = (mm.rows[0] as any)?.hi;
    if (lo && hi) {
      const fetchedFrom = String(lo) < from ? String(lo) : from;
      await writeMeta(sym, fetchedFrom, String(hi), 'fmp');
      meta = { fetched_from: fetchedFrom, last_date: String(hi), refreshed_at: new Date(0).toISOString(), provider: 'fmp' };
    }
  }

  // Смена провайдера (напр. подключили EODHD): цены по-разному скорректированы — нельзя дописывать
  // хвост к чужой истории. Чистим кэш тикера и тянем заново целиком новым провайдером.
  if (provider && meta && meta.provider !== provider.name) {
    await libsqlClient.execute({ sql: `DELETE FROM prices WHERE symbol=?`, args: [sym] });
    meta = null;
  }

  const haveStart = !!meta && meta.fetched_from <= from;
  const fresh = !!meta && Date.now() - Date.parse(meta.refreshed_at) < REFRESH_TTL_MS;
  const haveEnd = !!meta && meta.last_date >= to;
  // Полностью покрыто и свежо (или уже есть данные по запрошенный конец) → из БД, без сети.
  if (haveStart && (fresh || haveEnd)) return selectRange(sym, from, to);

  if (!provider) return selectRange(sym, from, to); // без ключей (e2e) — что есть в кэше

  // Идём к провайдеру: хвост, если начало уже покрыто; иначе всю историю (первый раз для тикера).
  const fetchFrom = haveStart && meta ? meta.last_date : from;
  try {
    const rows = await provider.fetch(sym, fetchFrom, to);
    if (rows.length) await upsertRows(sym, rows);
    const newFetchedFrom = meta ? (meta.fetched_from < from ? meta.fetched_from : from) : from;
    const fetchedLast = rows.length ? rows[rows.length - 1].date : '';
    const finalLast = meta ? (fetchedLast > meta.last_date ? fetchedLast : meta.last_date) : fetchedLast || to;
    await writeMeta(sym, newFetchedFrom, finalLast, provider.name);
    return selectRange(sym, from, to);
  } catch {
    return selectRange(sym, from, to); // провайдер недоступен — отдаём кэш
  }
}
