import { NextRequest, NextResponse } from 'next/server';
import { buildPortfolio } from '@/lib/quantconnect/portfolio';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/quantconnect/portfolio            — матрица годовых метрик (без архива)
// GET /api/quantconnect/portfolio?force=1    — пересчитать, минуя кэш бектестов
// GET /api/quantconnect/portfolio?archived=1 — включить стратегии в статусе «архив»
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const force = !!sp.get('force');
    const includeArchived = !!sp.get('archived');
    const data = await buildPortfolio(force, includeArchived);
    return NextResponse.json(data);
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/portfolio', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message, years: [], algos: [], benchmark: null }, { status: 500 });
  }
}
