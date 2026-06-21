import { NextRequest, NextResponse } from 'next/server';
import { getStrategyAllocation } from '@/lib/quantconnect/allocation';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/quantconnect/allocation?id=<algoId>          — оценка состава активов по годам
// GET /api/quantconnect/allocation?id=<algoId>&force=1  — минуя кэш сделок
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const id = Number(sp.get('id'));
    if (!id) return NextResponse.json({ error: 'id обязателен', years: [], symbols: [] }, { status: 400 });
    const data = await getStrategyAllocation(id, !!sp.get('force'));
    return NextResponse.json(data);
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/allocation', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message, years: [], symbols: [] }, { status: 500 });
  }
}
