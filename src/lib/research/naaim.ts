import { libsqlClient } from '@/db/client';
import { logAppError } from '@/lib/app-errors';

// Коннектор недельного ряда NAAIM Exposure Index (индикатор позиционирования активных управляющих,
// публикуется еженедельно на naaim.org). Источника у FMP/EODHD нет — это ВНЕШНИЙ ряд, поэтому:
//  1) надёжный путь — ручной ингест через защищённый /api/admin/naaim (source='manual');
//  2) best-effort авто-фетч (NAAIM_CSV_URL или naaim.org) с кэшем в БД;
//  3) детерминированная синтетика-фолбэк для офлайна/e2e (source='synthetic'), чтобы фича не падала.
// Точку-в-времени обеспечивает движок: вход — следующий торговый день ПОСЛЕ даты значения.

export type NaaimRow = { date: string; value: number };
export type NaaimBundle = { rows: NaaimRow[]; source: string; first: string; last: string; count: number };

const REFRESH_TTL_MS = 3 * 864e5; // недельный ряд — освежаем не чаще раза в ~3 дня
const DRE = /^\d{4}-\d{2}-\d{2}$/;

let ensured = false;
export async function ensureNaaimTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS naaim_exposure (
    week_date TEXT PRIMARY KEY,
    exposure REAL NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Одна строка-метка (id=1): источник + время последнего обновления для TTL.
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS naaim_meta (
    id INTEGER PRIMARY KEY,
    source TEXT,
    refreshed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

function cleanRows(raw: { date: string; value: number }[]): NaaimRow[] {
  const seen = new Map<string, number>();
  for (const r of raw) {
    const date = String(r.date).slice(0, 10);
    const v = Number(r.value);
    // NAAIM исторически в диапазоне ~ -200..+200; шире — мусор.
    if (DRE.test(date) && Number.isFinite(v) && v >= -250 && v <= 250) seen.set(date, v);
  }
  return [...seen.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function bundle(rows: NaaimRow[], source: string): NaaimBundle {
  return { rows, source, first: rows[0]?.date ?? '', last: rows[rows.length - 1]?.date ?? '', count: rows.length };
}

// ── Ингест (ручной/из фетча): upsert строк ──
export async function ingestNaaim(raw: { date: string; value: number }[], source: string): Promise<NaaimBundle> {
  await ensureNaaimTable();
  const rows = cleanRows(raw);
  if (rows.length) {
    const now = new Date().toISOString();
    const stmts = rows.map((r) => ({
      sql: `INSERT INTO naaim_exposure (week_date,exposure,source,created_at) VALUES (?,?,?,?)
            ON CONFLICT(week_date) DO UPDATE SET exposure=excluded.exposure, source=excluded.source`,
      args: [r.date, r.value, source, now] as (string | number)[],
    }));
    stmts.push({
      sql: `INSERT INTO naaim_meta (id,source,refreshed_at,created_at) VALUES (1,?,?,?)
            ON CONFLICT(id) DO UPDATE SET source=excluded.source, refreshed_at=excluded.refreshed_at`,
      args: [source, now, now],
    });
    // libsql ограничивает размер батча — режем на части по 400.
    for (let i = 0; i < stmts.length; i += 400) await libsqlClient.batch(stmts.slice(i, i + 400));
  }
  return bundle(rows, source);
}

async function readCache(): Promise<{ rows: NaaimRow[]; source: string; refreshedMs: number }> {
  await ensureNaaimTable();
  const r = await libsqlClient.execute('SELECT week_date, exposure FROM naaim_exposure ORDER BY week_date ASC');
  const rows = r.rows.map((x: any) => ({ date: String(x.week_date), value: Number(x.exposure) }));
  let source = 'cache';
  let refreshedMs = 0;
  try {
    const m = await libsqlClient.execute('SELECT source, refreshed_at FROM naaim_meta WHERE id=1');
    if (m.rows[0]) {
      source = String((m.rows[0] as any).source || 'cache');
      const ts = Date.parse(String((m.rows[0] as any).refreshed_at || ''));
      if (Number.isFinite(ts)) refreshedMs = ts;
    }
  } catch {
    /* meta может отсутствовать на старой БД */
  }
  return { rows, source, refreshedMs };
}

// ── Best-effort авто-фетч ──
// Парсит CSV "date,value" или JSON [{date,value}] / [[date,value]]. Источник:
//   1) NAAIM_CSV_URL (если задан) — самый надёжный (укажи прямой CSV/JSON-фид);
//   2) naaim.org — на практике рендерит график на клиенте и статически не отдаёт ряд,
//      поэтому обычно вернёт пусто (это ОК — упадём в кэш/синтетику).
function parseDelimited(text: string): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\D+(-?\d+(?:\.\d+)?)/);
    if (!m) continue;
    let d = m[1];
    if (d.includes('/')) {
      const [a, b, c] = d.split('/');
      const yr = c.length === 2 ? `20${c}` : c;
      d = `${yr}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
    }
    out.push({ date: d, value: Number(m[2]) });
  }
  return out;
}

async function fetchFromSource(): Promise<{ date: string; value: number }[]> {
  const url = process.env.NAAIM_CSV_URL;
  const candidates = [url, 'https://naaim.org/wp-content/uploads/exposure.csv'].filter(Boolean) as string[];
  for (const u of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(u, { signal: ctrl.signal, cache: 'no-store', headers: { 'user-agent': 'fmp-ratings/naaim' } });
      clearTimeout(t);
      if (!res.ok) continue;
      const body = await res.text();
      const rows = body.trim().startsWith('[') ? parseJsonRows(body) : parseDelimited(body);
      if (rows.length >= 50) return rows;
    } catch {
      /* пробуем следующий кандидат */
    }
  }
  return [];
}

function parseJsonRows(text: string): { date: string; value: number }[] {
  try {
    const j = JSON.parse(text);
    if (!Array.isArray(j)) return [];
    return j
      .map((x: any) => (Array.isArray(x) ? { date: String(x[0]), value: Number(x[1]) } : { date: String(x.date ?? x.d), value: Number(x.value ?? x.v) }))
      .filter((r) => r.date && Number.isFinite(r.value));
  } catch {
    return [];
  }
}

// ── Детерминированная синтетика (офлайн/e2e) ──
// Недельный ряд 2006→сегодня, AR(1) с возвратом к среднему ~60, диапазон ~ [-40..150].
// Значения зависят ТОЛЬКО от индекса недели → воспроизводимо в CI.
export function syntheticNaaim(): NaaimRow[] {
  const rows: NaaimRow[] = [];
  let s = 987654321 >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const mu = 60;
  let x = 65;
  const start = Date.UTC(2006, 0, 4); // первая среда января 2006
  const end = Date.now();
  for (let tms = start, i = 0; tms <= end; tms += 7 * 864e5, i++) {
    x = mu + 0.86 * (x - mu) + (rnd() - 0.5) * 36; // AR(1) + равномерный шум
    const v = Math.max(-40, Math.min(150, x));
    rows.push({ date: new Date(tms).toISOString().slice(0, 10), value: Math.round(v * 100) / 100 });
  }
  return rows;
}

// Главная точка входа для исследования: кэш-первым, при пустом/устаревшем — best-effort фетч,
// при неудаче — кэш, иначе синтетика. Никогда не бросает.
export async function getNaaimForStudy(): Promise<NaaimBundle> {
  try {
    const cache = await readCache();
    const fresh = cache.refreshedMs > 0 && Date.now() - cache.refreshedMs < REFRESH_TTL_MS;
    // Ручные данные не перетираем авто-фетчем; синтетику/пустоту — обновляем.
    if (cache.rows.length && (fresh || cache.source === 'manual')) return bundle(cache.rows, cache.source);

    const fetched = await fetchFromSource();
    if (fetched.length >= 50) return await ingestNaaim(fetched, process.env.NAAIM_CSV_URL ? 'csv-url' : 'naaim.org');

    if (cache.rows.length) return bundle(cache.rows, cache.source); // фетч не дал — отдаём что есть
  } catch (e: any) {
    logAppError({ route: '/api/signals/study', message: `NAAIM fetch: ${e?.message || e}`, stack: e?.stack, meta: { series: 'NAAIM' } }).catch(() => {});
  }
  return bundle(syntheticNaaim(), 'synthetic');
}

// Для статус-эндпоинта /api/admin/naaim (GET): что сейчас в кэше.
export async function getNaaimStatus(): Promise<NaaimBundle> {
  const cache = await readCache();
  return bundle(cache.rows, cache.source);
}
