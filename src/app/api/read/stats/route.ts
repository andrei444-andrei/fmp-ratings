import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    const stats: Record<string, number> = {};
    const tables: Array<[string, any]> = [
      ['sp500_current', schema.sp500Current],
      ['sp500_changes', schema.sp500Changes],
      ['market_cap', schema.marketCap],
      ['grades', schema.grades],
      ['top_n_per_year', schema.topNPerYear],
      ['rating_changes_filtered', schema.ratingChangesFiltered],
      ['runs', schema.runs],
    ];
    for (const [name, table] of tables) {
      const r = await db.select({ c: sql<number>`count(*)` }).from(table);
      stats[name] = Number(r[0]?.c ?? 0);
    }
    return NextResponse.json(stats);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
