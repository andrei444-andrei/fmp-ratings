import { NextRequest, NextResponse } from 'next/server';
import { fmpHistoricalPriceEod } from '@/lib/fmp';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');
  const from = url.searchParams.get('from') || undefined;
  const to = url.searchParams.get('to') || undefined;
  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }
  try {
    const data = await fmpHistoricalPriceEod(symbol, from, to);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
