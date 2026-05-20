import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { eq, and, gte, lte, asc, type SQL } from 'drizzle-orm';
import { computeStats, type Obs } from '@/lib/leverage/stats';

export const runtime = 'nodejs';

// GET /api/leverage/series/{id}?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv
// Экспорт/интеграционный эндпоинт одного ряда (см. SPEC 5.4).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;
    const format = url.searchParams.get('format') || 'json';

    const seriesRows = await db.select().from(schema.leverageSeries).where(eq(schema.leverageSeries.id, id));
    const meta = seriesRows[0];
    if (!meta) return NextResponse.json({ error: 'series not found' }, { status: 404 });

    const conds: SQL[] = [eq(schema.leverageObservations.seriesId, id)];
    if (from) conds.push(gte(schema.leverageObservations.date, from));
    if (to) conds.push(lte(schema.leverageObservations.date, to));

    const obsRows = await db
      .select({ date: schema.leverageObservations.date, value: schema.leverageObservations.value })
      .from(schema.leverageObservations)
      .where(and(...conds))
      .orderBy(asc(schema.leverageObservations.date));
    const obs: Obs[] = obsRows.map(r => ({ date: r.date, value: r.value }));

    if (format === 'csv') {
      const lines = ['date,value', ...obs.map(o => `${o.date},${o.value}`)];
      return new NextResponse('﻿' + lines.join('\n'), {
        headers: {
          'content-type': 'text/csv;charset=utf-8',
          'content-disposition': `attachment; filename="${id.replace(/[^a-z0-9._-]/gi, '_')}.csv"`,
        },
      });
    }

    const higherIsRisk = meta.higherIsRisk === 1;
    const stats = computeStats(obs, meta.frequency, higherIsRisk);
    return NextResponse.json({
      id: meta.id,
      label: meta.label,
      unit: meta.unit,
      metric: meta.metric,
      segment: meta.segment,
      frequency: meta.frequency,
      lagNote: meta.lagNote,
      indexSymbol: meta.indexSymbol,
      higherIsRisk,
      stats,
      observations: obs,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
