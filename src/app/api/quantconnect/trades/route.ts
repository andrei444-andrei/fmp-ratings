import { NextRequest, NextResponse } from 'next/server';
import { getStrategyTrades } from '@/lib/quantconnect/trades';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/quantconnect/trades?id=<algoId>          — сделки стратегии (резолвится по id)
// GET /api/quantconnect/trades?id=<algoId>&force=1  — пересчитать, минуя кэш
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const id = Number(sp.get('id'));
    if (!id) return NextResponse.json({ error: 'id обязателен', trades: [] }, { status: 400 });
    const data = await getStrategyTrades(id, !!sp.get('force'));
    return NextResponse.json(data);
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/trades', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message, trades: [] }, { status: 500 });
  }
}
