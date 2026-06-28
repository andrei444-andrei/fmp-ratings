import { getRisk } from '@/lib/terminal/risk';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Волатильность и риск-режим для /terminal. Snapshot-first; graceful без ключей (синтетика).
export async function GET() {
  try {
    const data = await getRisk();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e: any) {
    await logAppError({ route: '/api/market/risk', message: e?.message || 'risk failed', stack: e?.stack });
    return Response.json({ error: e?.message || 'risk failed' }, { status: 500 });
  }
}
