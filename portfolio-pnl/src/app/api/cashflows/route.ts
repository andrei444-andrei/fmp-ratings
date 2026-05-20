import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES = ['contribution', 'withdrawal', 'income'];

export async function GET() {
  const rows = await db.select().from(schema.cashflows);
  return NextResponse.json({ cashflows: rows });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const quarter = String(body.quarter || '').trim();
    const type = String(body.type || '');
    const amount = Number(body.amount);
    if (!/^\d{4}Q[1-4]$/.test(quarter)) return NextResponse.json({ error: 'Некорректный quarter' }, { status: 400 });
    if (!TYPES.includes(type)) return NextResponse.json({ error: 'Некорректный type' }, { status: 400 });
    if (!Number.isFinite(amount)) return NextResponse.json({ error: 'Некорректный amount' }, { status: 400 });
    await db.insert(schema.cashflows).values({
      quarter,
      type,
      assetClass: body.assetClass || null,
      amount,
      note: body.note || null,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 });
  await db.delete(schema.cashflows).where(eq(schema.cashflows.id, Number(id)));
  return NextResponse.json({ ok: true });
}
