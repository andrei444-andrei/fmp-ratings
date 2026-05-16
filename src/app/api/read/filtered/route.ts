import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { desc, eq, and } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const yearStr = url.searchParams.get('year');
  const minJumpStr = url.searchParams.get('minJump');
  const conds: any[] = [];
  if (yearStr) conds.push(eq(schema.ratingChangesFiltered.year, Number(yearStr)));
  if (minJumpStr) conds.push(eq(schema.ratingChangesFiltered.minJump, Number(minJumpStr)));
  const q = db.select().from(schema.ratingChangesFiltered).orderBy(desc(schema.ratingChangesFiltered.date));
  const rows = conds.length ? await q.where(and(...conds)) : await q;
  return NextResponse.json(rows);
}
