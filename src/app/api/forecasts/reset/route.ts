import { NextRequest, NextResponse } from 'next/server';
import { resetForecasts } from '@/lib/forecasts/store';
import { friendlyWriteError } from '@/lib/db-write-guard';
import { logAppError } from '@/lib/app-errors';

// POST /api/forecasts/reset — отладочный сброс кэша прогнозов, чтобы AI пересобрал
// заново. body: { scope?: 'ai'|'all', asset?, year? }. 'ai' — только несверённые
// AI/синтетика (по умолч.); 'all' — всё, включая ручные.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const scope: 'ai' | 'all' = body?.scope === 'all' ? 'all' : 'ai';
    const asset = typeof body?.asset === 'string' ? body.asset : undefined;
    const year = Number.isInteger(body?.year) ? body.year : undefined;
    const result = await resetForecasts({ scope, asset, year });
    return NextResponse.json(result);
  } catch (e: any) {
    await logAppError({ route: '/api/forecasts/reset', message: e?.message || 'reset failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ error: friendlyWriteError(e) }, { status: 500 });
  }
}
