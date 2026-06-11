import { NextRequest, NextResponse } from 'next/server';
import { listAlgorithms, addAlgorithm, removeAlgorithm } from '@/lib/quantconnect/algorithms';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET    /api/quantconnect/algorithms            — портфель алгоритмов
// POST   /api/quantconnect/algorithms { ... }    — добавить
// DELETE /api/quantconnect/algorithms?id=        — удалить
export async function GET() {
  try {
    return NextResponse.json({ algorithms: await listAlgorithms() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await addAlgorithm(body);
    if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ algorithm: res.algorithm, algorithms: await listAlgorithms() });
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/algorithms', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
    await removeAlgorithm(id);
    return NextResponse.json({ algorithms: await listAlgorithms() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
