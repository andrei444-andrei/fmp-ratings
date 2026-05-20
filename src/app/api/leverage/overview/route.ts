import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { eq, asc } from 'drizzle-orm';
import { computeStats, compositeIndex, type Obs } from '@/lib/leverage/stats';
import { SEGMENT_LABELS } from '@/lib/leverage/registry';
import { ensureLeverageTables } from '@/lib/leverage/store';

export const runtime = 'nodejs';

// GET /api/leverage/overview
// Возвращает все ряды со статистикой (z-score, светофор, спарклайн) + композитный индекс.
export async function GET() {
  try {
    await ensureLeverageTables();
    const series = await db.select().from(schema.leverageSeries);
    const out: any[] = [];
    const compInput: Array<{ segment: string; zscore: number | null; higherIsRisk: boolean }> = [];

    for (const s of series) {
      const obsRows = await db
        .select({ date: schema.leverageObservations.date, value: schema.leverageObservations.value })
        .from(schema.leverageObservations)
        .where(eq(schema.leverageObservations.seriesId, s.id))
        .orderBy(asc(schema.leverageObservations.date));
      const obs: Obs[] = obsRows.map(r => ({ date: r.date, value: r.value }));
      const higherIsRisk = s.higherIsRisk === 1;
      const stats = computeStats(obs, s.frequency, higherIsRisk);
      out.push({
        id: s.id,
        source: s.source,
        segment: s.segment,
        segmentLabel: SEGMENT_LABELS[s.segment] ?? s.segment,
        label: s.label,
        unit: s.unit,
        metric: s.metric,
        frequency: s.frequency,
        lagNote: s.lagNote,
        indexSymbol: s.indexSymbol,
        higherIsRisk,
        updatedAt: s.updatedAt,
        count: obs.length,
        stats,
      });
      compInput.push({ segment: s.segment, zscore: stats.zscore, higherIsRisk });
    }

    const composite = compositeIndex(compInput);

    // группировка по сегментам для удобства UI
    const segments: Record<string, { label: string; items: string[] }> = {};
    for (const item of out) {
      const seg = item.segment;
      if (!segments[seg]) segments[seg] = { label: item.segmentLabel, items: [] };
      segments[seg].items.push(item.id);
    }

    out.sort((a, b) => {
      const za = Math.abs(a.stats.zscore ?? -1);
      const zb = Math.abs(b.stats.zscore ?? -1);
      return zb - za;
    });

    return NextResponse.json({ series: out, composite, segments });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
