import { getOverview } from '@/lib/terminal/overview';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Обзор рынка для главной /terminal. Snapshot-first: тёплый снапшот мгновенно,
// холодный — расчёт+кэш. Graceful без ключей/БД (синтетика). Ошибки → app_errors (§2).
export async function GET() {
  try {
    const overview = await getOverview();
    return Response.json(overview, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e: any) {
    await logAppError({ route: '/api/market/overview', message: e?.message || 'overview failed', stack: e?.stack });
    return Response.json({ error: e?.message || 'overview failed' }, { status: 500 });
  }
}
