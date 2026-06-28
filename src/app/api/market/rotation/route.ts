import { getRotation } from '@/lib/terminal/rotation';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ротация секторов (RRG) для /terminal. Snapshot-first; graceful без ключей (синтетика).
export async function GET() {
  try {
    const data = await getRotation();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e: any) {
    await logAppError({ route: '/api/market/rotation', message: e?.message || 'rotation failed', stack: e?.stack });
    return Response.json({ error: e?.message || 'rotation failed' }, { status: 500 });
  }
}
