import { NextRequest, NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';

const ALLOWED = new Set([
  'sp500_current','sp500_changes','market_cap','grades','consensus_history',
  'top_n_per_year','rating_changes_filtered','runs',
]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const table = url.searchParams.get('table') || '';
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  if (!ALLOWED.has(table)) return NextResponse.json({ error: 'unknown table' }, { status: 400 });
  try {
    const res = await libsqlClient.execute(`SELECT * FROM "${table}" LIMIT ${limit}`);
    return NextResponse.json({
      columns: res.columns,
      rows: res.rows.map(r => Object.fromEntries(res.columns.map((c, i) => [c, (r as any)[i]]))),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
