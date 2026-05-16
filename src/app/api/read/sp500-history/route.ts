import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { desc } from 'drizzle-orm';

export async function GET() {
  const current = await db.select().from(schema.sp500Current);
  const history = await db.select().from(schema.sp500Changes).orderBy(desc(schema.sp500Changes.date));
  return NextResponse.json({ current, history });
}
