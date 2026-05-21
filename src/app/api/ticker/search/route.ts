import { NextRequest, NextResponse } from 'next/server';
import { fmpSearchSymbol } from '@/lib/fmp';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// GET /api/ticker/search?q=app → [{ symbol, name, exchange }]
export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 1) return NextResponse.json({ results: [] });
  try {
    const data = await fmpSearchSymbol(q, 12);
    const arr: any[] = Array.isArray(data) ? data : [];
    const results = arr
      .map(r => ({
        symbol: String(r.symbol || '').toUpperCase(),
        name: String(r.name || r.companyName || ''),
        exchange: String(r.exchangeShortName || r.exchange || ''),
      }))
      .filter(r => r.symbol);
    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), results: [] }, { status: 502 });
  }
}
