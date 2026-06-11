import { NextRequest, NextResponse } from 'next/server';
import { buildPortfolio } from '@/lib/quantconnect/portfolio';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/quantconnect/portfolio          — матрица годовых метрик портфеля
// GET /api/quantconnect/portfolio?force=1  — пересчитать, минуя кэш бектестов
export async function GET(req: NextRequest) {
  try {
    const force = !!new URL(req.url).searchParams.get('force');
    const data = await buildPortfolio(force);
    return NextResponse.json(data);
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/portfolio', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message, years: [], algos: [], benchmark: null }, { status: 500 });
  }
}
