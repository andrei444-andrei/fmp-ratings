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
    // Защитная фильтрация: FMP иногда возвращает данные шире запрошенного окна
    if (Array.isArray(data) && (from || to)) {
      const filtered = data.filter((r: any) => {
        if (!r || typeof r.date !== 'string') return false;
        if (from && r.date < from) return false;
        if (to && r.date > to) return false;
        return true;
      });
      return NextResponse.json(filtered);
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
