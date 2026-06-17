import { libsqlClient } from '@/db/client';
import { fmpSp500Current, fmpScreener } from '@/lib/fmp';
import { MEGA_STOCKS, UNIVERSE_PRESETS } from '@/lib/signals/presets';

// Динамические списки вселенной для /signals:
//  - preset=mega → текущий состав S&P 500 (≈500 ликвидных крупнокапов США) из FMP;
//  - preset=<страна>_stocks → топ-N ликвидных акций страны через FMP screener (по капитализации).
// Кэш в БД на 7 дней; при недоступности FMP — последний кэш, иначе статический список пресета.
export const dynamic = 'force-dynamic';

const TTL_MS = 7 * 24 * 3600 * 1000;
const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,13}$/;
const TOP_N = 80;

let ensured = false;
async function ensure(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS signals_universe (
    preset TEXT PRIMARY KEY,
    tickers TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

async function readCache(preset: string): Promise<{ tickers: string[]; at: number } | null> {
  try {
    const r = await libsqlClient.execute({ sql: `SELECT tickers, fetched_at FROM signals_universe WHERE preset = ?`, args: [preset] });
    const x = r.rows[0] as any;
    if (!x) return null;
    const tickers = JSON.parse(String(x.tickers));
    return { tickers: Array.isArray(tickers) ? tickers : [], at: Date.parse(String(x.fetched_at)) || 0 };
  } catch {
    return null;
  }
}

async function fetchTickers(preset: string, country?: string): Promise<string[]> {
  if (country) {
    const data: any = await fmpScreener({ country, isEtf: false, isActivelyTrading: true, limit: 600 });
    const arr: any[] = Array.isArray(data) ? data : [];
    return arr
      .filter((x) => Number.isFinite(Number(x?.marketCap)))
      .sort((a, b) => Number(b.marketCap) - Number(a.marketCap))
      .map((x) => String(x?.symbol ?? '').toUpperCase().trim())
      .filter((s) => TICKER.test(s))
      .slice(0, TOP_N);
  }
  // mega → S&P 500
  const data: any = await fmpSp500Current();
  const arr: any[] = Array.isArray(data) ? data : [];
  return [...new Set(arr.map((x) => String(x?.symbol ?? '').toUpperCase().trim()).filter((s) => TICKER.test(s)))];
}

export async function GET(req: Request) {
  const preset = new URL(req.url).searchParams.get('preset') || 'mega';
  const def = UNIVERSE_PRESETS.find((p) => p.id === preset);
  if (!def) return Response.json({ error: 'unknown preset' }, { status: 400 });
  if (!def.dynamic) return Response.json({ tickers: def.tickers, source: 'static' });

  const minCount = def.country ? 5 : 100; // у небольших рынков допускаем меньше
  try {
    await ensure();
  } catch {
    return Response.json({ tickers: preset === 'mega' ? MEGA_STOCKS : def.tickers, source: 'fallback' });
  }
  const cached = await readCache(preset);
  if (cached && cached.tickers.length >= minCount && Date.now() - cached.at < TTL_MS) {
    return Response.json({ tickers: cached.tickers, source: 'cache' });
  }
  try {
    const tickers = await fetchTickers(preset, def.country);
    if (tickers.length >= minCount) {
      const now = new Date().toISOString();
      await libsqlClient.execute({
        sql: `INSERT INTO signals_universe (preset, tickers, fetched_at) VALUES (?, ?, ?)
              ON CONFLICT(preset) DO UPDATE SET tickers=excluded.tickers, fetched_at=excluded.fetched_at`,
        args: [preset, JSON.stringify(tickers), now],
      });
      return Response.json({ tickers, source: 'fmp' });
    }
  } catch {
    /* нет ключа / нет тарифа на междунар. данные — падаем на кэш/статику */
  }
  if (cached && cached.tickers.length) return Response.json({ tickers: cached.tickers, source: 'cache-stale' });
  return Response.json({ tickers: preset === 'mega' ? MEGA_STOCKS : def.tickers, source: 'fallback' });
}
