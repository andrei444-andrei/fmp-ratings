import { NextRequest, NextResponse } from 'next/server';
import { listSets, upsert, remove } from '@/lib/ticker-sets';

// GET    /api/ticker-sets            — все наборы (с авто-сидингом дефолтов)
// POST   /api/ticker-sets  { row }   — создать/обновить набор
// DELETE /api/ticker-sets?id=        — удалить
export async function GET() {
  try {
    return NextResponse.json({ sets: await listSets() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const row = await req.json();
    if (!row || (row.kind !== 'sector' && row.kind !== 'country')) {
      return NextResponse.json({ error: 'kind должен быть sector|country' }, { status: 400 });
    }
    await upsert(row);
    return NextResponse.json({ sets: await listSets() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await remove(id);
    return NextResponse.json({ sets: await listSets() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
