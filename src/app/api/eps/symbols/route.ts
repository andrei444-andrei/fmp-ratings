import { NextRequest, NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';

// Возвращает уникальные символы из top_n_per_year по диапазону лет.
// Этот же «топ» используется в Pipeline/Results — то есть универсум совпадает.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const fromYear = Number(url.searchParams.get('fromYear') || 0);
    const toYear = Number(url.searchParams.get('toYear') || 9999);
    const topN = Number(url.searchParams.get('topN') || 500);

    const res = await libsqlClient.execute({
      sql: `SELECT DISTINCT symbol
            FROM top_n_per_year
            WHERE year BETWEEN ? AND ? AND rank <= ?
            ORDER BY symbol`,
      args: [fromYear, toYear, topN],
    });
    const symbols = res.rows.map((r: any) => String(r.symbol));
    return NextResponse.json({ symbols, count: symbols.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
