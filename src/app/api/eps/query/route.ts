import { NextRequest, NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';

// Параметры:
//   fromYear, toYear      — диапазон годов (по дате отчёта)
//   topN                  — учитывать только rank <= topN (когда restrictToTop=1)
//   restrictToTop         — '1' (default): только если символ был в топ-N в год отчёта
//   direction             — 'beat' | 'miss' | 'any'
//   minSurprisePct        — модуль |% сюрприза| ≥ X (для beat и miss)
//   maxSurprisePct        — модуль |% сюрприза| ≤ X (опц.)
//   symbol                — фильтр по символу
//   year                  — конкретный год (alias для fromYear=toYear=year)
//   limit                 — макс. строк (default 5000)
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const p = url.searchParams;
    const year = p.get('year');
    const fromYear = Number(year || p.get('fromYear') || 1900);
    const toYear = Number(year || p.get('toYear') || 9999);
    const topN = Number(p.get('topN') || 50);
    const restrictToTop = (p.get('restrictToTop') ?? '1') === '1';
    const direction = (p.get('direction') || 'any') as 'beat' | 'miss' | 'any';
    const minSurprisePct = p.get('minSurprisePct') != null ? Number(p.get('minSurprisePct')) : null;
    const maxSurprisePct = p.get('maxSurprisePct') != null ? Number(p.get('maxSurprisePct')) : null;
    const symbol = (p.get('symbol') || '').trim().toUpperCase();
    const limit = Math.min(Number(p.get('limit') || 5000), 50000);

    const where: string[] = [];
    const args: any[] = [];

    where.push(`CAST(substr(e.date, 1, 4) AS INTEGER) BETWEEN ? AND ?`);
    args.push(fromYear, toYear);

    if (symbol) { where.push(`e.symbol = ?`); args.push(symbol); }

    if (direction === 'beat') where.push(`e.surprise > 0`);
    else if (direction === 'miss') where.push(`e.surprise < 0`);

    if (minSurprisePct != null && Number.isFinite(minSurprisePct)) {
      where.push(`ABS(e.surprise_pct) >= ?`);
      args.push(minSurprisePct);
    }
    if (maxSurprisePct != null && Number.isFinite(maxSurprisePct)) {
      where.push(`ABS(e.surprise_pct) <= ?`);
      args.push(maxSurprisePct);
    }
    where.push(`e.eps_actual IS NOT NULL AND e.eps_estimated IS NOT NULL`);

    let sqlText: string;
    if (restrictToTop) {
      // Point-in-time: показываем отчёт только если символ был в топ-N в год отчёта
      where.push(`t.symbol IS NOT NULL`);
      sqlText = `
        SELECT e.symbol, e.date, e.fiscal_date_ending, e.eps_actual, e.eps_estimated,
               e.surprise, e.surprise_pct, e.revenue_actual, e.revenue_estimated,
               CAST(substr(e.date, 1, 4) AS INTEGER) AS year,
               t.rank AS rank
        FROM eps_surprises e
        LEFT JOIN top_n_per_year t
          ON t.symbol = e.symbol
         AND t.year = CAST(substr(e.date, 1, 4) AS INTEGER)
         AND t.rank <= ?
        WHERE ${where.join(' AND ')}
        ORDER BY e.date DESC
        LIMIT ?`;
      args.unshift(topN);
      args.push(limit);
    } else {
      sqlText = `
        SELECT e.symbol, e.date, e.fiscal_date_ending, e.eps_actual, e.eps_estimated,
               e.surprise, e.surprise_pct, e.revenue_actual, e.revenue_estimated,
               CAST(substr(e.date, 1, 4) AS INTEGER) AS year,
               NULL AS rank
        FROM eps_surprises e
        WHERE ${where.join(' AND ')}
        ORDER BY e.date DESC
        LIMIT ?`;
      args.push(limit);
    }

    const res = await libsqlClient.execute({ sql: sqlText, args });
    const events = res.rows.map((r: any) => ({
      symbol: r.symbol,
      date: r.date,
      fiscalDateEnding: r.fiscal_date_ending,
      epsActual: r.eps_actual,
      epsEstimated: r.eps_estimated,
      surprise: r.surprise,
      surprisePct: r.surprise_pct,
      revenueActual: r.revenue_actual,
      revenueEstimated: r.revenue_estimated,
      year: Number(r.year),
      rank: r.rank != null ? Number(r.rank) : null,
    }));

    const beat = events.filter(e => (e.surprise ?? 0) > 0).length;
    const miss = events.filter(e => (e.surprise ?? 0) < 0).length;
    return NextResponse.json({
      events,
      stats: { count: events.length, beat, miss, flat: events.length - beat - miss },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
