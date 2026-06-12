import { NextRequest, NextResponse } from 'next/server';
import { generateDescription } from '@/lib/quantconnect/describe';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/quantconnect/describe { projectId } — сгенерировать описание стратегии
// по её коду QuantConnect (AI). Возвращает { description }.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = String(body.projectId ?? '').trim();
    if (!/^\d+$/.test(projectId)) return NextResponse.json({ error: 'projectId обязателен (число)' }, { status: 400 });
    const description = await generateDescription(projectId);
    return NextResponse.json({ description });
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/describe', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
