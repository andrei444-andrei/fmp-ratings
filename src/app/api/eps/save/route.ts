import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';

// Принимает массив сырых записей FMP /stable/earnings (или с уже посчитанным surprise).
// Нормализует поля под разные имена и считает surprise/surprisePct, если их нет.
// INSERT OR REPLACE по (symbol, date) — допускает повторный запуск без дублей.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body)) return NextResponse.json({ error: 'expected array' }, { status: 400 });
    const now = new Date().toISOString();

    const rows = body
      .map((r: any) => {
        const symbol = r.symbol;
        const date = r.date || r.fillingDate || r.fiscalDateEnding;
        if (!symbol || !date) return null;

        const epsActual = pickNum(r.epsActual, r.actualEarningResult, r.eps, r.epsActuals);
        const epsEstimated = pickNum(r.epsEstimated, r.estimatedEarning, r.estimatedEps);
        const revenueActual = pickNum(r.revenueActual, r.revenue);
        const revenueEstimated = pickNum(r.revenueEstimated, r.estimatedRevenue);

        let surprise: number | null = null;
        let surprisePct: number | null = null;
        if (epsActual != null && epsEstimated != null) {
          surprise = epsActual - epsEstimated;
          const denom = Math.abs(epsEstimated);
          if (denom > 1e-9) surprisePct = (surprise / denom) * 100;
        }

        return {
          symbol: String(symbol),
          date: String(date).slice(0, 10),
          fiscalDateEnding: r.fiscalDateEnding ? String(r.fiscalDateEnding).slice(0, 10) : null,
          epsActual,
          epsEstimated,
          surprise,
          surprisePct,
          revenueActual,
          revenueEstimated,
          fetchedAt: now,
          raw: JSON.stringify(r),
        };
      })
      .filter(Boolean) as any[];

    if (!rows.length) return NextResponse.json({ inserted: 0 });

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await db.insert(schema.epsSurprises).values(slice).onConflictDoUpdate({
        target: [schema.epsSurprises.symbol, schema.epsSurprises.date],
        set: {
          fiscalDateEnding: sql`excluded.fiscal_date_ending`,
          epsActual: sql`excluded.eps_actual`,
          epsEstimated: sql`excluded.eps_estimated`,
          surprise: sql`excluded.surprise`,
          surprisePct: sql`excluded.surprise_pct`,
          revenueActual: sql`excluded.revenue_actual`,
          revenueEstimated: sql`excluded.revenue_estimated`,
          fetchedAt: sql`excluded.fetched_at`,
          raw: sql`excluded.raw`,
        },
      });
    }
    return NextResponse.json({ inserted: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function pickNum(...vals: any[]): number | null {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
