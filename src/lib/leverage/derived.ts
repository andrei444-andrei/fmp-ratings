import { db, schema } from '@/db/client';
import { eq, asc } from 'drizzle-orm';
import type { Obs } from './stats';
import type { SeriesDef } from './registry';
import { upsertSeries, upsertObservations } from './store';

// Производный ряд: FINRA margin debt, нормированный на Wilshire 5000.
// Абсолютный margin debt растёт вместе с рынком, поэтому сам по себе мало
// о чём говорит; деление на капитализацию (через Wilshire 5000) убирает
// рыночный тренд и даёт чистый сигнал «насколько плечо натянуто».
export const MARGIN_DEBT_TO_WILSHIRE: SeriesDef = {
  id: 'derived:margin_debt_to_wilshire',
  source: 'finra',
  segment: 'us_equities',
  label: 'Margin Debt / Wilshire 5000 (норм.)',
  unit: '×1000',
  metric: 'margin_debt_to_mktcap',
  frequency: 'monthly',
  lagNote: '~3–5 недель (по FINRA)',
  indexSymbol: '^GSPC',
  higherIsRisk: true,
};

const MARGIN_ID = 'finra:margin_debt';
const WILSHIRE_ID = 'fred:WILL5000IND';

async function loadObs(seriesId: string): Promise<Obs[]> {
  const rows = await db
    .select({ date: schema.leverageObservations.date, value: schema.leverageObservations.value })
    .from(schema.leverageObservations)
    .where(eq(schema.leverageObservations.seriesId, seriesId))
    .orderBy(asc(schema.leverageObservations.date));
  return rows.map(r => ({ date: r.date, value: r.value }));
}

// Для каждой даты margin debt берём значение Wilshire на эту дату или ближайшее
// предшествующее (оба ряда отсортированы по возрастанию — идём указателем).
export async function recomputeMarginDebtToWilshire(): Promise<{ rows: number; reason?: string }> {
  const margin = await loadObs(MARGIN_ID);
  const wilshire = await loadObs(WILSHIRE_ID);
  if (!margin.length) return { rows: 0, reason: 'нет FINRA margin debt' };
  if (!wilshire.length) return { rows: 0, reason: 'нет Wilshire 5000 (загрузите FRED)' };

  const out: Obs[] = [];
  let wi = 0;
  for (const m of margin) {
    // продвигаем указатель до последнего Wilshire с датой <= m.date
    while (wi + 1 < wilshire.length && wilshire[wi + 1].date <= m.date) wi++;
    const w = wilshire[wi];
    if (!w || w.date > m.date || w.value <= 0) continue;
    out.push({ date: m.date, value: (m.value / w.value) * 1000 });
  }
  if (!out.length) return { rows: 0, reason: 'не удалось выровнять даты' };

  await upsertSeries(MARGIN_DEBT_TO_WILSHIRE);
  const rows = await upsertObservations(MARGIN_DEBT_TO_WILSHIRE.id, out);
  return { rows };
}
