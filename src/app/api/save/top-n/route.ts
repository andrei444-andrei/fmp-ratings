import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';

// body: { year: number, rows: [{rank, symbol, marketCap, snapshotDate}] }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const year = Number(body.year);
    const rows = body.rows;
    if (!year || !Array.isArray(rows)) return NextResponse.json({ error: 'year + rows required' }, { status: 400 });
    const records = rows
      .filter((r: any) => r && r.symbol && r.rank != null)
      .map((r: any) => ({
        year,
        rank: Number(r.rank),
        symbol: String(r.symbol),
        marketCap: r.marketCap != null ? Number(r.marketCap) : null,
        snapshotDate: r.snapshotDate || null,
      }));
    // overwrite year
    await db.delete(schema.topNPerYear).where(eq(schema.topNPerYear.year, year));
    if (records.length) await db.insert(schema.topNPerYear).values(records);
    return NextResponse.json({ inserted: records.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
