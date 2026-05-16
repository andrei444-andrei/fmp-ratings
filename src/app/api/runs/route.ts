import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { eq, desc } from 'drizzle-orm';

// POST { startYear, endYear, topN, minJump } → создаёт run-record, возвращает id
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const [row] = await db.insert(schema.runs).values({
      startedAt: new Date().toISOString(),
      status: 'running',
      startYear: body.startYear || null,
      endYear: body.endYear || null,
      topN: body.topN || null,
      minJump: body.minJump || null,
    }).returning();
    return NextResponse.json({ id: row.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH { id, status, notes, rowsWritten } — обновить статус
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await db.update(schema.runs)
      .set({
        status: body.status || 'completed',
        finishedAt: new Date().toISOString(),
        notes: body.notes || null,
        rowsWritten: body.rowsWritten != null ? Number(body.rowsWritten) : null,
      })
      .where(eq(schema.runs.id, id));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const rows = await db.select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(50);
  return NextResponse.json(rows);
}
