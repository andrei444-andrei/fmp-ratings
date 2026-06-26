import { NextRequest } from 'next/server';
import { computeAndCache } from '@/lib/research/screenPanel';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Прогрев кэша панелей для пресет-вселенных — чтобы скринер открывался МГНОВЕННО (данные «уже подготовлены»).
// Можно дёргать кроном (GET) раз в сутки. Считает per-ticker панели и кладёт в screen_panel.
const PRESET_TICKERS = [...new Set([
  'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC',
  'EWJ', 'EWG', 'EWU', 'EWZ', 'INDA', 'EWA', 'EWC', 'FXI', 'EWY', 'EWT',
  'GLD', 'SLV', 'USO', 'UNG', 'DBA', 'DBB', 'DBC', 'PALL', 'PPLT', 'CORN',
  'CPER', 'URA', 'URNM', 'GDX', 'SIL',
  'SMH', 'SOXX', 'ARKK', 'ICLN', 'TAN', 'LIT', 'BOTZ', 'HACK', 'SKYY',
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'XOM',
])];

async function warm(horizons: number[]) {
  let warmed = 0;
  const errors: string[] = [];
  for (const h of horizons) {
    for (let i = 0; i < PRESET_TICKERS.length; i += 35) {
      const chunk = PRESET_TICKERS.slice(i, i + 35);
      const r = await computeAndCache(chunk, h);
      if ('error' in r) errors.push(`h${h}:${r.error}`);
      else warmed += r.perTicker.size;
    }
  }
  return { warmed, errors, tickers: PRESET_TICKERS.length, horizons };
}

function parseHorizons(req: NextRequest): number[] {
  const raw = req.nextUrl.searchParams.get('horizons');
  const hs = (raw ? raw.split(',') : ['21']).map((x) => Math.max(1, Math.min(63, Math.round(Number(x) || 0)))).filter(Boolean);
  return hs.length ? [...new Set(hs)] : [21];
}

async function handle(req: NextRequest) {
  try {
    const res = await warm(parseHorizons(req));
    return Response.json({ ok: true, ...res });
  } catch (e: any) {
    logAppError({ route: '/api/researcher/warm', message: e?.message || String(e), stack: e?.stack }).catch(() => {});
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export const GET = handle;   // для крона
export const POST = handle;
