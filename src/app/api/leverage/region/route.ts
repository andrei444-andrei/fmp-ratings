import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { ensureLeverageTables, upsertSeries, upsertObservations } from '@/lib/leverage/store';
import { parseRegionCsv, mdmcId, regionName } from '@/lib/leverage/regions';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST { code, csv } — импорт ряда Margin Debt / Market Cap по региону.
// CSV: date + (margin_debt & market_cap) либо date + pct.
export async function POST(req: NextRequest) {
  try {
    await ensureLeverageTables();
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || '').trim().toUpperCase();
    const csv = body?.csv;
    if (!code) return NextResponse.json({ error: 'нужен code региона (US, KR, JP, ...)' }, { status: 400 });
    if (code === 'US') return NextResponse.json({ error: 'США считается автоматически (Загрузить США)' }, { status: 400 });
    if (typeof csv !== 'string' || !csv.trim()) return NextResponse.json({ error: 'нужен csv' }, { status: 400 });

    const { obs, mode, header } = parseRegionCsv(csv);
    const id = mdmcId(code);
    await upsertSeries({
      id,
      source: 'manual',
      segment: 'mdmc',
      label: regionName(code),
      unit: '% mkt cap',
      metric: 'margin_debt_pct_mktcap',
      frequency: 'monthly',
      lagNote: 'ручной импорт',
      higherIsRisk: true,
    });
    const rows = await upsertObservations(id, obs);
    return NextResponse.json({ ok: true, code, mode, header, rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/leverage/region?code=KR — удалить регион.
export async function DELETE(req: NextRequest) {
  try {
    const code = String(new URL(req.url).searchParams.get('code') || '').trim().toUpperCase();
    if (!code) return NextResponse.json({ error: 'нужен code' }, { status: 400 });
    const id = mdmcId(code);
    await db.delete(schema.leverageObservations).where(eq(schema.leverageObservations.seriesId, id));
    await db.delete(schema.leverageSeries).where(eq(schema.leverageSeries.id, id));
    return NextResponse.json({ ok: true, code });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
