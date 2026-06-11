import { NextRequest, NextResponse } from 'next/server';
import { qcListBacktests } from '@/lib/quantconnect/client';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/quantconnect/backtests?projectId=123 — бектесты проекта (для выбора).
export async function GET(req: NextRequest) {
  try {
    const projectId = (new URL(req.url).searchParams.get('projectId') || '').trim();
    if (!/^\d+$/.test(projectId)) return NextResponse.json({ error: 'projectId обязателен (число)' }, { status: 400 });
    const backtests = await qcListBacktests(projectId);
    return NextResponse.json({ backtests });
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/backtests', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
