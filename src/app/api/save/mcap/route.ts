import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body)) return NextResponse.json({ error: 'expected array' }, { status: 400 });
    const rows = body
      .filter(r => r && r.symbol && r.date && r.marketCap != null)
      .map((r: any) => ({ symbol: String(r.symbol), date: String(r.date), marketCap: Number(r.marketCap) }));
    if (!rows.length) return NextResponse.json({ inserted: 0 });
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await db.insert(schema.marketCap).values(slice).onConflictDoUpdate({
        target: [schema.marketCap.symbol, schema.marketCap.date],
        set: { marketCap: sql`excluded.market_cap` },
      });
      inserted += slice.length;
    }
    return NextResponse.json({ inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
