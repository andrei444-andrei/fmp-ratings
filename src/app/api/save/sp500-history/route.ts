import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body)) return NextResponse.json({ error: 'expected array' }, { status: 400 });
    const rows = body.map((c: any) => ({
      date: c.date || c.dateAdded || '',
      addedSymbol: c.symbol || c.addedSymbol || c.added || null,
      removedSymbol: c.removedTicker || c.removedSymbol || c.removed || null,
      reason: c.reason || null,
      raw: JSON.stringify(c),
    })).filter(r => r.date);
    if (!rows.length) return NextResponse.json({ inserted: 0 });
    // wipe + insert (snapshot)
    await db.delete(schema.sp500Changes);
    // chunk inserts (libsql limit ~1000 statements per batch)
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(schema.sp500Changes).values(rows.slice(i, i + CHUNK));
    }
    return NextResponse.json({ inserted: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
