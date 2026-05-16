import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { and, gte, lte } from 'drizzle-orm';

// GET /api/read/market-cap-range?from=YYYY-MM-DD&to=YYYY-MM-DD
// Возвращает { [symbol]: { date, marketCap } } — кэш для Phase 1.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from, to required' }, { status: 400 });
  const rows = await db.select().from(schema.marketCap)
    .where(and(gte(schema.marketCap.date, from), lte(schema.marketCap.date, to)));
  // На symbol может быть несколько дат в диапазоне — берём самую позднюю.
  const map: Record<string, { date: string; marketCap: number }> = {};
  for (const r of rows) {
    const cur = map[r.symbol];
    if (!cur || r.date > cur.date) map[r.symbol] = { date: r.date, marketCap: r.marketCap };
  }
  return NextResponse.json(map);
}
