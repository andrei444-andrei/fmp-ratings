import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import type { Obs } from './stats';
import type { SeriesDef } from './registry';

export async function upsertSeries(def: SeriesDef): Promise<void> {
  await db.insert(schema.leverageSeries).values({
    id: def.id,
    source: def.source,
    segment: def.segment,
    label: def.label,
    unit: def.unit,
    metric: def.metric,
    frequency: def.frequency,
    lagNote: def.lagNote,
    indexSymbol: def.indexSymbol ?? null,
    higherIsRisk: def.higherIsRisk ? 1 : 0,
    meta: null,
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: schema.leverageSeries.id,
    set: {
      label: sql`excluded.label`,
      unit: sql`excluded.unit`,
      segment: sql`excluded.segment`,
      metric: sql`excluded.metric`,
      frequency: sql`excluded.frequency`,
      lagNote: sql`excluded.lag_note`,
      indexSymbol: sql`excluded.index_symbol`,
      higherIsRisk: sql`excluded.higher_is_risk`,
      updatedAt: sql`excluded.updated_at`,
    },
  });
}

export async function upsertObservations(seriesId: string, obs: Obs[]): Promise<number> {
  if (!obs.length) return 0;
  const rows = obs.map(o => ({ seriesId, date: o.date, value: o.value }));
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await db.insert(schema.leverageObservations).values(slice).onConflictDoUpdate({
      target: [schema.leverageObservations.seriesId, schema.leverageObservations.date],
      set: { value: sql`excluded.value` },
    });
  }
  return rows.length;
}
