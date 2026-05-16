import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { eq, asc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const yearStr = url.searchParams.get('year');
  if (yearStr) {
    const year = Number(yearStr);
    const rows = await db.select().from(schema.topNPerYear)
      .where(eq(schema.topNPerYear.year, year))
      .orderBy(asc(schema.topNPerYear.rank));
    return NextResponse.json(rows);
  }
  // все годы, сгруппировано
  const all = await db.select().from(schema.topNPerYear).orderBy(asc(schema.topNPerYear.year), asc(schema.topNPerYear.rank));
  const byYear: Record<number, any[]> = {};
  for (const r of all) (byYear[r.year] = byYear[r.year] || []).push(r);
  return NextResponse.json(byYear);
}
