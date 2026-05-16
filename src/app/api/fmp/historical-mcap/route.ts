import { NextRequest, NextResponse } from 'next/server';
import { fmpHistoricalMcap } from '@/lib/fmp';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!symbol || !from || !to) {
    return NextResponse.json({ error: 'symbol, from, to are required' }, { status: 400 });
  }
  try {
    const data = await fmpHistoricalMcap(symbol, from, to);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
