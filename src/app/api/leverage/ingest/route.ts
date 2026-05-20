import { NextRequest, NextResponse } from 'next/server';
import { fetchFredSeries } from '@/lib/leverage/fred';
import { fetchCftcNetPctOi } from '@/lib/leverage/cftc';
import { parseFinraCsv, fetchFinraAuto } from '@/lib/leverage/finra';
import { upsertSeries, upsertObservations, ensureLeverageTables } from '@/lib/leverage/store';
import { FRED_SERIES, CFTC_MARKETS, cftcSeriesDef, FINRA_SERIES } from '@/lib/leverage/registry';

export const runtime = 'nodejs';
export const maxDuration = 60;

type IngestResult = { id: string; label: string; rows: number; error?: string };

// POST { source: 'fred' | 'cftc' | 'finra', csv?: string }
// Тянет (или парсит) данные источника и апсертит ряды + наблюдения.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const source = body?.source;
    const results: IngestResult[] = [];

    await ensureLeverageTables();

    if (source === 'fred') {
      for (const def of FRED_SERIES) {
        const seriesId = def.id.split(':')[1];
        try {
          await upsertSeries(def);
          const obs = await fetchFredSeries(seriesId);
          const rows = await upsertObservations(def.id, obs);
          results.push({ id: def.id, label: def.label, rows });
        } catch (e: any) {
          results.push({ id: def.id, label: def.label, rows: 0, error: e.message });
        }
      }
    } else if (source === 'cftc') {
      for (const m of CFTC_MARKETS) {
        const def = cftcSeriesDef(m);
        try {
          await upsertSeries(def);
          const obs = await fetchCftcNetPctOi(m);
          const rows = await upsertObservations(def.id, obs);
          results.push({ id: def.id, label: def.label, rows });
        } catch (e: any) {
          results.push({ id: def.id, label: def.label, rows: 0, error: e.message });
        }
      }
    } else if (source === 'finra') {
      const csv = body?.csv;
      // Если CSV не передан — качаем файл напрямую с сервера FINRA (auto).
      let sourceUrl: string | undefined;
      let parsed;
      if (typeof csv === 'string' && csv.trim()) {
        parsed = parseFinraCsv(csv);
      } else {
        const auto = await fetchFinraAuto();
        sourceUrl = auto.sourceUrl;
        parsed = auto;
      }
      for (const key of ['margin_debt', 'free_credit'] as const) {
        const def = FINRA_SERIES[key];
        const obs = parsed[key];
        if (!obs.length) {
          results.push({ id: def.id, label: def.label, rows: 0, error: 'колонка не найдена в CSV' });
          continue;
        }
        await upsertSeries(def);
        const rows = await upsertObservations(def.id, obs);
        results.push({ id: def.id, label: def.label, rows });
      }
      return NextResponse.json({ ok: true, source, sourceUrl, headerUsed: parsed.headerUsed, results });
    } else {
      return NextResponse.json({ error: 'source должен быть fred | cftc | finra' }, { status: 400 });
    }

    const failed = results.filter(r => r.error).length;
    return NextResponse.json({ ok: failed === 0, source, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
