import { libsqlClient } from '@/db/client';
import { fmpSp500Current } from '@/lib/fmp';
import { MEGA_STOCKS } from '@/lib/signals/presets';

// Динамический список «крупных/ликвидных акций» = текущие компоненты S&P 500 (≈500 ликвидных
// крупнокапов США) из FMP. Кэшируется в БД на 7 дней; при недоступности FMP — последний кэш,
// иначе статический fallback (MEGA_STOCKS). Используется пресетом «Крупные акции» на /signals.
export const dynamic = 'force-dynamic';

const TTL_MS = 7 * 24 * 3600 * 1000;
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

async function readCache(): Promise<{ tickers: string[]; at: number } | null> {
  try {
    const r = await libsqlClient.execute({ sql: `SELECT tickers, fetched_at FROM signals_universe WHERE preset = ?`, args: ['mega'] });
    const x = r.rows[0] as any;
    if (!x) return null;
    const tickers = JSON.parse(String(x.tickers));
    return { tickers: Array.isArray(tickers) ? tickers : [], at: Date.parse(String(x.fetched_at)) || 0 };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    await ensure();
  } catch {
    return Response.json({ mega: MEGA_STOCKS, source: 'fallback' });
  }
  const cached = await readCache();
  if (cached && cached.tickers.length >= 100 && Date.now() - cached.at < TTL_MS) {
    return Response.json({ mega: cached.tickers, source: 'cache' });
  }
  // Тянем актуальный состав S&P 500 из FMP.
  try {
    const data: any = await fmpSp500Current();
    const arr: any[] = Array.isArray(data) ? data : [];
    const tickers = [
      ...new Set(
        arr
          .map((x) => String(x?.symbol ?? '').toUpperCase().trim())
          .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)),
      ),
    ];
    if (tickers.length >= 100) {
      const now = new Date().toISOString();
      await libsqlClient.execute({
        sql: `INSERT INTO signals_universe (preset, tickers, fetched_at) VALUES (?, ?, ?)
              ON CONFLICT(preset) DO UPDATE SET tickers=excluded.tickers, fetched_at=excluded.fetched_at`,
        args: ['mega', JSON.stringify(tickers), now],
      });
      return Response.json({ mega: tickers, source: 'fmp' });
    }
  } catch {
    /* нет ключа / ошибка FMP — падаем на кэш/статику */
  }
  if (cached && cached.tickers.length) return Response.json({ mega: cached.tickers, source: 'cache-stale' });
  return Response.json({ mega: MEGA_STOCKS, source: 'fallback' });
}
