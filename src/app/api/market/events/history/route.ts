import { historyFor } from '@/lib/terminal/econ-history';
import { lookupIndicator } from '@/lib/terminal/indicator-info';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Детали метрики для радара событий: описание/методология (из выверенной базы знаний)
// + история прошлых значений (FMP economic-calendar, кэш). Graceful без ключей.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') || '';
  try {
    const info = lookupIndicator(q);
    const { series, synthetic } = await historyFor(q);
    return Response.json(
      { q, info, series, synthetic },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } },
    );
  } catch (e: any) {
    await logAppError({ route: '/api/market/events/history', message: e?.message || 'history failed', stack: e?.stack });
    return Response.json({ q, info: null, series: [], synthetic: true });
  }
}
