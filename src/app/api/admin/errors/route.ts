import { NextRequest, NextResponse } from 'next/server';
import { getRecentErrors } from '@/lib/app-errors';

// Канонический дамп последних ошибок (§2): GET /api/admin/errors?limit=N
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get('limit') || '100');
    return NextResponse.json({ errors: await getRecentErrors(limit) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
