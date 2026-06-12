import { NextRequest, NextResponse } from 'next/server';
import { buildSeries } from '@/lib/quantconnect/portfolio';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/quantconnect/series            — месячные ряды капитала стратегий (+ бенчмарк)
// GET /api/quantconnect/series?force=1    — пересчитать, минуя кэш
// GET /api/quantconnect/series?archived=1 — включить стратегии в статусе «архив»
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const data = await buildSeries(!!sp.get('force'), !!sp.get('archived'));
    return NextResponse.json(data);
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/series', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message, algos: [], benchmark: null }, { status: 500 });
  }
}
