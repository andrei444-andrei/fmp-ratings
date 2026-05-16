import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';

// INSERT OR IGNORE: существующие строки не трогаем — данные накопительные.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body)) return NextResponse.json({ error: 'expected array' }, { status: 400 });
    const rows = body
      .filter(r => r && r.symbol && r.date && r.marketCap != null)
      .map((r: any) => ({ symbol: String(r.symbol), date: String(r.date), marketCap: Number(r.marketCap) }));
    if (!rows.length) return NextResponse.json({ inserted: 0 });
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(schema.marketCap).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
    }
    return NextResponse.json({ inserted: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
