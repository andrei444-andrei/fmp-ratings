import { libsqlClient } from '@/db/client';
import { fmpHistoricalPriceEod } from '@/lib/fmp';
import { eodhdEod } from '@/lib/eodhd';

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
  for (const col of ['provider TEXT', 'epoch TEXT']) {
    try {
      await libsqlClient.execute(`ALTER TABLE price_meta ADD COLUMN ${col}`);
    } catch {
      /* колонка уже есть */
    }
  }
  ensured = true;
}

export type PriceRow = { date: string; close: number; volume: number | null };

const REFRESH_TTL_MS = 12 * 3600 * 1000; // освежаем хвост не чаще раза в ~12ч (EOD-данные)
// Версия кэша цен. Бамп → одноразовый полный рефетч на тикер (лечит битый/короткий кэш, напр. после
// неудачного переключения провайдера). Меняем, когда нужно пере-набрать историю у всех бумаг.
// '4': принудительный одноразовый рефетч — лечит кэши, «застрявшие» на старой дате (напр. 2022)
// из-за прежнего бага (сбой/устаревший хвост основного провайдера не давал добор резервным).
const PRICES_EPOCH = '4';
const MIN_FULL_ROWS = 60; // меньше — считаем, что нормальной истории нет (не затираем чужой кэш этим)

type Meta = { fetched_from: string; last_date: string; refreshed_at: string; provider: string; epoch: string };

async function readMeta(sym: string): Promise<Meta | null> {
  const r = await libsqlClient.execute({ sql: `SELECT fetched_from, last_date, refreshed_at, provider, epoch FROM price_meta WHERE symbol=?`, args: [sym] });
  const x = r.rows[0] as any;
  return x
    ? { fetched_from: String(x.fetched_from), last_date: String(x.last_date), refreshed_at: String(x.refreshed_at), provider: x.provider ? String(x.provider) : 'fmp', epoch: x.epoch ? String(x.epoch) : '1' }
    : null;
}

async function writeMeta(sym: string, fetchedFrom: string, lastDate: string, provider: string): Promise<void> {
  await libsqlClient.execute({
    sql: `INSERT INTO price_meta (symbol, fetched_from, last_date, refreshed_at, provider, epoch) VALUES (?,?,?,?,?,?)
          ON CONFLICT(symbol) DO UPDATE SET fetched_from=excluded.fetched_from, last_date=excluded.last_date, refreshed_at=excluded.refreshed_at, provider=excluded.provider, epoch=excluded.epoch`,
    args: [sym, fetchedFrom, lastDate, new Date().toISOString(), provider, PRICES_EPOCH],
  });
}

async function priceExtent(sym: string): Promise<{ min: string; count: number }> {
  const r = await libsqlClient.execute({ sql: `SELECT MIN(date) AS lo, COUNT(*) AS c FROM prices WHERE symbol=? AND close IS NOT NULL`, args: [sym] });
  const x = r.rows[0] as any;
  return { min: x?.lo ? String(x.lo) : '', count: Number(x?.c || 0) };
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

type Provider = { name: string; fetch: (sym: string, from: string, to: string) => Promise<PriceRow[]> };

// Провайдеры цен в порядке приоритета. EODHD — ОСНОВНОЙ (скорректированные цены adjusted_close →
// корректные корп.события, широкое гео), FMP — ДОБОР пробелов (символы/формы, которых нет в EODHD).
// Предохранители ниже (don't-downgrade + эпоха) не дают короткому/битому ответу ухудшить рабочий кэш.
function priceProviders(): Provider[] {
  const list: Provider[] = [];
  if (process.env.EODHD_API_KEY) list.push({ name: 'eodhd', fetch: eodhdEod });
  if (process.env.FMP_API_KEY) list.push({ name: 'fmp', fetch: fetchFromFmp });
  return list;
}

function lastDateOf(rs: PriceRow[]): string {
  return rs.length ? rs[rs.length - 1].date : '';
}
function minusDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Грузим у основного провайдера, НО устойчиво к его сбоям: если основной упал (исключение),
// вернул слишком мало ИЛИ его хвост устарел относительно запрошенного конца `to` — пробуем
// резервного и берём ряд, покрывающий ДАЛЬШЕ/полнее. Это чинит «застревание» на старой дате
// (напр. 2022), когда EODHD для тикера недоступен/не обновляет хвост, а FMP имеет свежие данные
// (раньше исключение основного провайдера вообще пропускало добор и отдавало только кэш).
async function fetchResilient(
  provs: Provider[],
  sym: string,
  from: string,
  to: string,
): Promise<{ rows: PriceRow[]; used: string }> {
  const primary = provs[0];
  let rows: PriceRow[] = [];
  let used = primary?.name ?? '';
  try {
    rows = primary ? await primary.fetch(sym, from, to) : [];
  } catch {
    rows = []; // сбой основного НЕ должен прерывать добор резервным
  }
  const staleCut = minusDaysISO(to, 10); // нормальный EOD-лаг (выходные/праздники) не считаем «устаревшим»
  const needAlt = rows.length === 0 || rows.length < MIN_FULL_ROWS || lastDateOf(rows) < staleCut;
  if (needAlt && provs[1]) {
    try {
      const alt = await provs[1].fetch(sym, from, to);
      if (alt.length && (rows.length === 0 || lastDateOf(alt) > lastDateOf(rows) || alt.length > rows.length)) {
        rows = alt;
        used = provs[1].name;
      }
    } catch {
      /* резервный недоступен — оставляем, что есть */
    }
  }
  return { rows, used };
}

/** Возвращает дневные close+volume за период. Кэш-первым; в FMP идём только если тикер не покрыт
 *  с нужного начала ИЛИ устарел — и тогда доливаем только хвост [last_date..to]. */
export async function getPrices(symbol: string, from: string, to: string): Promise<PriceRow[]> {
  await ensurePricesTable();
  const sym = symbol.toUpperCase();
  const provs = priceProviders();
  const primary = provs[0] ?? null;

  let meta = await readMeta(sym);
  // Бутстрап покрытия из легаси-данных (таблица prices без price_meta): доверяем как FMP-истории
  // текущей эпохи, чтобы не перекачивать заново.
  if (!meta) {
    const ex = await priceExtent(sym);
    if (ex.count > 0) {
      const mm = await libsqlClient.execute({ sql: `SELECT MAX(date) AS hi FROM prices WHERE symbol=? AND close IS NOT NULL`, args: [sym] });
      const hi = String((mm.rows[0] as any)?.hi || to);
      const fetchedFrom = ex.min && ex.min < from ? ex.min : from;
      await writeMeta(sym, fetchedFrom, hi, 'fmp');
      meta = { fetched_from: fetchedFrom, last_date: hi, refreshed_at: new Date(0).toISOString(), provider: 'fmp', epoch: PRICES_EPOCH };
    }
  }

  // Новая эпоха кэша → один раз набираем историю заново (лечит битый/короткий кэш), но НЕ разрушительно
  // (старые данные удаляем только когда новые не хуже — см. ниже).
  const epochStale = !!meta && meta.epoch !== PRICES_EPOCH;
  const haveStart = !!meta && meta.fetched_from <= from && !epochStale;
  const fresh = !!meta && Date.now() - Date.parse(meta.refreshed_at) < REFRESH_TTL_MS && !epochStale;
  const haveEnd = !!meta && meta.last_date >= to;
  // Полностью покрыто и свежо (или уже есть данные по запрошенный конец) → из БД, без сети.
  if (haveStart && (fresh || haveEnd)) return selectRange(sym, from, to);

  if (!primary) return selectRange(sym, from, to); // без ключей (e2e) — что есть в кэше

  const fullFetch = epochStale || !haveStart;
  const fetchFrom = fullFetch ? from : meta!.last_date;
  try {
    // Основной провайдер с устойчивым добором резервным (при сбое/нехватке/устаревшем хвосте).
    const { rows, used } = await fetchResilient(provs, sym, fetchFrom, to);

    if (fullFetch) {
      // НЕ ухудшаем покрытие: заменяем кэш только если новые данные не короче существующих
      // (иначе короткий ответ провайдера затёр бы рабочую историю). Иначе — оставляем как есть.
      const ex = await priceExtent(sym);
      const newMin = rows.length ? rows[0].date : '';
      // «Не хуже» = либо нет старых данных, либо новые начинаются не позже, либо покрывают ≥80% баров.
      // Так глубокий EODHD примется (≈равно FMP), а усечённый (1 год vs 25 лет) — будет отвергнут.
      const notWorse = rows.length >= MIN_FULL_ROWS && (ex.count === 0 || (!!newMin && newMin <= ex.min) || rows.length >= ex.count * 0.8);
      if (!notWorse) {
        if (meta) await writeMeta(sym, meta.fetched_from, meta.last_date, meta.provider); // фиксируем эпоху, не зацикливаемся
        return selectRange(sym, from, to);
      }
      await libsqlClient.execute({ sql: `DELETE FROM prices WHERE symbol=?`, args: [sym] });
      if (rows.length) await upsertRows(sym, rows);
      await writeMeta(sym, from, rows.length ? rows[rows.length - 1].date : to, used);
      return selectRange(sym, from, to);
    }

    // Тот же провайдер/эпоха: доливаем только хвост.
    if (rows.length) await upsertRows(sym, rows);
    const newFetchedFrom = meta!.fetched_from < from ? meta!.fetched_from : from;
    const fetchedLast = rows.length ? rows[rows.length - 1].date : '';
    const finalLast = fetchedLast > meta!.last_date ? fetchedLast : meta!.last_date;
    await writeMeta(sym, newFetchedFrom, finalLast, meta!.provider);
    return selectRange(sym, from, to);
  } catch {
    return selectRange(sym, from, to); // провайдер недоступен — отдаём кэш (старые данные не тронуты)
  }
}
