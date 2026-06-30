import { getRadar } from '@/lib/terminal/radar';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Радар событий (датированная лента: значимые макро + отчётности). Snapshot-first, graceful.
export async function GET() {
  try {
    const data = await getRadar();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    });
  } catch (e: any) {
    await logAppError({ route: '/api/market/radar', message: e?.message || 'radar failed', stack: e?.stack });
    return Response.json({ error: e?.message || 'radar failed' }, { status: 500 });
  }
}
