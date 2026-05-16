import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body)) return NextResponse.json({ error: 'expected array' }, { status: 400 });
    const now = new Date().toISOString();
    const rows = body.map((c: any) => ({
      symbol: c.symbol,
      name: c.name || c.companyName || null,
      sector: c.sector || null,
      subSector: c.subSector || null,
      founded: c.founded || null,
      fetchedAt: now,
    })).filter(r => r.symbol);
    if (!rows.length) return NextResponse.json({ inserted: 0 });
    // wipe + insert (current snapshot)
    await db.delete(schema.sp500Current);
    await db.insert(schema.sp500Current).values(rows);
    return NextResponse.json({ inserted: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
