import { NextRequest, NextResponse } from 'next/server';
import { qcListProjects } from '@/lib/quantconnect/client';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/quantconnect/projects?q=ema — список проектов QuantConnect (фильтр по имени).
export async function GET(req: NextRequest) {
  try {
    const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
    let projects = await qcListProjects();
    if (q) projects = projects.filter(p => p.name.toLowerCase().includes(q) || String(p.projectId).includes(q));
    // По свежести изменения (если поле есть), затем ограничиваем.
    projects.sort((a, b) => Date.parse(b.modified || '') - Date.parse(a.modified || '') || b.projectId - a.projectId);
    return NextResponse.json({ projects: projects.slice(0, 50) });
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/projects', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
