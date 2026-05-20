import { db, schema } from '@/db/client';
import { eq, asc } from 'drizzle-orm';
import type { Obs } from './stats';
import type { SeriesDef } from './registry';
import { upsertSeries, upsertObservations } from './store';

// Производная метрика: margin debt как % от рыночной капитализации.
// Абсолютный margin debt растёт вместе с рынком, поэтому сам по себе мало
// о чём говорит; деление на капитализацию убирает рыночный тренд.
// Формула: FINRA margin debt / market cap * 100 (оба в USD mln).
export const MARGIN_DEBT_PCT_MKTCAP: SeriesDef = {
  id: 'derived:margin_debt_pct_mktcap',
  source: 'finra',
  segment: 'us_equities',
  label: 'Margin Debt / Market Cap',
  unit: '% mkt cap',
  metric: 'margin_debt_pct_mktcap',
  frequency: 'monthly',
  lagNote: '~3–5 недель (по FINRA)',
  indexSymbol: '^GSPC',
  higherIsRisk: true,
};

const MARGIN_ID = 'finra:margin_debt';
const MKTCAP_ID = 'fred:NCBEILQ027S';
// Прежний вариант (нормировка на индекс Wilshire) — удаляем, чтобы не дублировался.
const OBSOLETE_ID = 'derived:margin_debt_to_wilshire';

async function loadObs(seriesId: string): Promise<Obs[]> {
  const rows = await db
    .select({ date: schema.leverageObservations.date, value: schema.leverageObservations.value })
    .from(schema.leverageObservations)
    .where(eq(schema.leverageObservations.seriesId, seriesId))
    .orderBy(asc(schema.leverageObservations.date));
  return rows.map(r => ({ date: r.date, value: r.value }));
}

// Для каждой даты margin debt берём капитализацию на эту дату или ближайшую
// предшествующую (market cap квартальный, margin debt месячный — идём указателем).
export async function recomputeMarginDebtPctMktcap(): Promise<{ rows: number; reason?: string }> {
  // чистим устаревший ряд (отношение к Wilshire)
  await db.delete(schema.leverageObservations).where(eq(schema.leverageObservations.seriesId, OBSOLETE_ID));
  await db.delete(schema.leverageSeries).where(eq(schema.leverageSeries.id, OBSOLETE_ID));

  const margin = await loadObs(MARGIN_ID);
  const cap = await loadObs(MKTCAP_ID);
  if (!margin.length) return { rows: 0, reason: 'нет FINRA margin debt' };
  if (!cap.length) return { rows: 0, reason: 'нет market cap (загрузите FRED)' };

  const out: Obs[] = [];
  let ci = 0;
  for (const m of margin) {
    while (ci + 1 < cap.length && cap[ci + 1].date <= m.date) ci++;
    const c = cap[ci];
    if (!c || c.date > m.date || c.value <= 0) continue;
    out.push({ date: m.date, value: (m.value / c.value) * 100 });
  }
  if (!out.length) return { rows: 0, reason: 'не удалось выровнять даты' };

  await upsertSeries(MARGIN_DEBT_PCT_MKTCAP);
  const rows = await upsertObservations(MARGIN_DEBT_PCT_MKTCAP.id, out);
  return { rows };
}
