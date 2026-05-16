import { NextRequest, NextResponse } from 'next/server';
import { fmpGrades } from '@/lib/fmp';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }
  try {
    const data = await fmpGrades(symbol);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
