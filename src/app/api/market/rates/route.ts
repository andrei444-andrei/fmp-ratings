import { getRates } from '@/lib/terminal/rates';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Кривая доходности и макро-ставки для /terminal. Snapshot-first; graceful без ключей (синтетика).
export async function GET() {
  try {
    const data = await getRates();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e: any) {
    await logAppError({ route: '/api/market/rates', message: e?.message || 'rates failed', stack: e?.stack });
    return Response.json({ error: e?.message || 'rates failed' }, { status: 500 });
  }
}
