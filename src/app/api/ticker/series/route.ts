import { getTickerSeries } from '@/lib/ticker/panel';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Ряды close по настраиваемому набору активов — для виджета корреляций (клиент выравнивает по датам).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get('symbols') || '').split(',').map((s) => s.toUpperCase().trim()).filter(Boolean);
  try {
    if (!symbols.length) return Response.json({ series: {} });
    const series = await getTickerSeries(symbols);
    return Response.json({ series });
  } catch (e: any) {
    logAppError({ route: '/api/ticker/series', message: e?.message || String(e), stack: e?.stack }).catch(() => {});
    return Response.json({ series: {} }, { status: 200 });
  }
}
