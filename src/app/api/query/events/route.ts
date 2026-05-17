import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { normalizeRating, labelFor } from '@/lib/rating';

// GET /api/query/events
//   ?topN=50              (rank ≤ N в top_n_per_year)
//   &direction=upgrade|downgrade|any
//   &minJump=1..4         (минимальный размер скачка по модулю)
//   &fromRating=1..5      (исходный рейтинг, опционально)
//   &toRating=1..5        (новый рейтинг, опционально)
//   &consensus=below|above|any
//   &year=YYYY            (опционально)
//   &limit=1000
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const topN = Math.max(1, Number(url.searchParams.get('topN')) || 50);
    const direction = url.searchParams.get('direction') || 'upgrade'; // upgrade/downgrade/any
    const minJump = Math.max(1, Number(url.searchParams.get('minJump')) || 1);
    const fromRatingStr = url.searchParams.get('fromRating');
    const toRatingStr = url.searchParams.get('toRating');
    const fromRating = fromRatingStr ? Number(fromRatingStr) : null;
    const toRating = toRatingStr ? Number(toRatingStr) : null;
    const consensus = url.searchParams.get('consensus') || 'any'; // below/above/any
    const yearFilter = url.searchParams.get('year');
    const limit = Math.min(20000, Number(url.searchParams.get('limit')) || 5000);

    // Загружаем membership: year+symbol → rank
    const topRows = await db.select().from(schema.topNPerYear);
    const membership: Record<number, Record<string, number>> = {};
    for (const r of topRows) {
      if (r.rank > topN) continue;
      (membership[r.year] = membership[r.year] || {})[r.symbol] = r.rank;
    }

    const allGrades = await db.select().from(schema.grades);
    const allConsensus = await db.select().from(schema.consensusHistory);

    // consensus by symbol, sorted by date asc
    const consBySym: Record<string, typeof allConsensus> = {};
    for (const c of allConsensus) (consBySym[c.symbol] = consBySym[c.symbol] || []).push(c);
    for (const sym of Object.keys(consBySym)) {
      consBySym[sym].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }

    const out: any[] = [];
    let consFromFmp = 0, consMissing = 0;

    for (const g of allGrades) {
      const eventYear = parseInt((g.date || '').slice(0, 4));
      if (!eventYear) continue;
      if (yearFilter && eventYear !== Number(yearFilter)) continue;
      const memberMap = membership[eventYear];
      if (!memberMap) continue;
      const rank = memberMap[g.symbol];
      if (!rank) continue;

      const newN = normalizeRating(g.newGrade);
      const oldN = normalizeRating(g.previousGrade);
      if (newN == null || oldN == null) continue;

      const jump = newN - oldN;
      if (direction === 'upgrade' && jump <= 0) continue;
      if (direction === 'downgrade' && jump >= 0) continue;
      if (Math.abs(jump) < minJump) continue;
      if (fromRating != null && oldN !== fromRating) continue;
      if (toRating != null && newN !== toRating) continue;

      // consensus — берём последнюю запись с date ≤ event.date
      const consList = consBySym[g.symbol] || [];
      let bestC: typeof consList[number] | null = null;
      for (const c of consList) {
        if ((c.date || '') > (g.date || '')) break;
        bestC = c;
      }
      let consScore: number | null = null;
      let consFirms: number | null = null;
      if (bestC && bestC.consensusScore != null) {
        consScore = bestC.consensusScore;
        consFirms = bestC.totalAnalysts;
        consFromFmp++;
      } else {
        consMissing++;
      }
      const below = consScore != null && newN < consScore ? 1 : 0;
      const above = consScore != null && newN > consScore ? 1 : 0;
      if (consensus === 'below' && !below) continue;
      if (consensus === 'above' && !above) continue;

      out.push({
        year: eventYear,
        date: g.date,
        symbol: g.symbol,
        rank,
        newRating: labelFor(newN),
        previousRating: labelFor(oldN),
        newRatingNum: newN,
        previousRatingNum: oldN,
        newGradeRaw: g.newGrade,
        previousGradeRaw: g.previousGrade,
        gradingCompany: g.gradingCompany,
        action: g.action,
        jumpSize: jump,
        consensusBefore: consScore,
        consensusFirmCount: consFirms,
        belowConsensus: below,
      });
      if (out.length >= limit) break;
    }
    out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return NextResponse.json({
      events: out,
      stats: { count: out.length, consFromFmp, consMissing },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
