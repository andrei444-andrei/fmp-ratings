import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body)) return NextResponse.json({ error: 'expected array' }, { status: 400 });
    const rows = body
      .filter(r => r && r.symbol && r.date)
      .map((r: any) => ({
        symbol: String(r.symbol),
        date: String(r.date),
        newGrade: r.newGrade || null,
        previousGrade: r.previousGrade || null,
        gradingCompany: r.gradingCompany || null,
        action: r.action || null,
      }));
    if (!rows.length) return NextResponse.json({ inserted: 0 });
    // Идемпотентность: чистим записи по уникальным символам, потом пишем.
    const uniqSymbols = Array.from(new Set(rows.map(r => r.symbol)));
    for (const sym of uniqSymbols) {
      await db.delete(schema.grades).where(eq(schema.grades.symbol, sym));
    }
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(schema.grades).values(rows.slice(i, i + CHUNK));
    }
    return NextResponse.json({ inserted: rows.length, symbols: uniqSymbols.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
