import { getEvents } from '@/lib/terminal/events';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Радар событий (макро + отчёты) для /terminal. Snapshot-first; graceful без ключей.
export async function GET() {
  try {
    const data = await getEvents();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    });
  } catch (e: any) {
    await logAppError({ route: '/api/market/events', message: e?.message || 'events failed', stack: e?.stack });
    return Response.json({ error: e?.message || 'events failed' }, { status: 500 });
  }
}
