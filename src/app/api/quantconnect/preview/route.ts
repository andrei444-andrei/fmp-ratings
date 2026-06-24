import { NextRequest, NextResponse } from 'next/server';
import { buildPreviewColumn } from '@/lib/quantconnect/portfolio';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/quantconnect/preview?projectId=X[&backtestId=Y][&force=1]
// Ad-hoc колонка для матрицы «Сравнение по годам» — без добавления в портфель.
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = (sp.get('projectId') || '').trim();
    if (!/^\d+$/.test(projectId)) return NextResponse.json({ error: 'projectId должен быть числом' }, { status: 400 });
    const backtestId = sp.get('backtestId')?.trim() || null;
    const column = await buildPreviewColumn(projectId, backtestId, !!sp.get('force'));
    return NextResponse.json({ column });
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/preview', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
