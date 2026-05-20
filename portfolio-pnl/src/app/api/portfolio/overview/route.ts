import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { computeOverview, type HoldingRow, type CashflowRow, type SegmentMetaRow } from '@/lib/compute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const asOf = new URL(req.url).searchParams.get('asOf');
    let holdings = (await db.select().from(schema.holdings)) as unknown as HoldingRow[];
    let cashflows = (await db.select().from(schema.cashflows)) as unknown as CashflowRow[];
    const meta = (await db.select().from(schema.segmentMeta)) as unknown as SegmentMetaRow[];
    if (asOf) {
      holdings = holdings.filter((h) => h.quarter <= asOf);
      cashflows = cashflows.filter((c) => c.quarter <= asOf);
    }
    const data = computeOverview(holdings, cashflows, meta);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
