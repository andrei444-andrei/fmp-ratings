import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { like, asc, eq } from 'drizzle-orm';
import { ensureLeverageTables } from '@/lib/leverage/store';
import { regionName, regionColor } from '@/lib/leverage/regions';

export const runtime = 'nodejs';

// GET /api/leverage/mdmc
// Все ряды Margin Debt / Market Cap по регионам (id вида mdmc:*) с наблюдениями.
export async function GET() {
  try {
    await ensureLeverageTables();
    const series = await db
      .select()
      .from(schema.leverageSeries)
      .where(like(schema.leverageSeries.id, 'mdmc:%'));

    const regions = [];
    for (const s of series) {
      const code = s.id.split(':')[1];
      const obs = await db
        .select({ date: schema.leverageObservations.date, value: schema.leverageObservations.value })
        .from(schema.leverageObservations)
        .where(eq(schema.leverageObservations.seriesId, s.id))
        .orderBy(asc(schema.leverageObservations.date));
      regions.push({
        code,
        name: regionName(code),
        color: regionColor(code),
        lagNote: s.lagNote,
        updatedAt: s.updatedAt,
        observations: obs.map(o => ({ date: o.date, value: o.value })),
      });
    }
    regions.sort((a, b) => (a.code === 'US' ? -1 : b.code === 'US' ? 1 : a.code.localeCompare(b.code)));
    return NextResponse.json({ regions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
