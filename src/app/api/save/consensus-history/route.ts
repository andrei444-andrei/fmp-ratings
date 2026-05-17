import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';

// body: { symbol: string, rows: any[] }
// FMP может возвращать поля в разных регистрах — нормализуем здесь.
function pick(r: any, ...keys: string[]): number | null {
  for (const k of keys) if (r[k] != null) return Number(r[k]);
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = String(body.symbol || '');
    const rows = body.rows;
    if (!symbol || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'symbol + rows required' }, { status: 400 });
    }
    const prepared = rows.map((r: any) => {
      const date = String(r.date || r.recordDate || '');
      const sb = pick(r, 'strongBuy', 'analystRatingsStrongBuy', 'strong_buy');
      const b = pick(r, 'buy', 'analystRatingsbuy', 'analystRatingsBuy');
      const h = pick(r, 'hold', 'analystRatingsHold');
      const s = pick(r, 'sell', 'analystRatingsSell');
      const ss = pick(r, 'strongSell', 'analystRatingsStrongSell', 'strong_sell');
      const total = (sb || 0) + (b || 0) + (h || 0) + (s || 0) + (ss || 0);
      const score = total > 0
        ? ((sb || 0) * 5 + (b || 0) * 4 + (h || 0) * 3 + (s || 0) * 2 + (ss || 0) * 1) / total
        : null;
      return {
        symbol: r.symbol || symbol,
        date,
        strongBuy: sb,
        buy: b,
        hold: h,
        sell: s,
        strongSell: ss,
        totalAnalysts: total > 0 ? total : null,
        consensusScore: score,
        raw: JSON.stringify(r),
      };
    }).filter(r => r.date);
    if (!prepared.length) return NextResponse.json({ inserted: 0 });
    const CHUNK = 500;
    for (let i = 0; i < prepared.length; i += CHUNK) {
      await db.insert(schema.consensusHistory).values(prepared.slice(i, i + CHUNK)).onConflictDoNothing();
    }
    return NextResponse.json({ inserted: prepared.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
