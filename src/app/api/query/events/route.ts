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
    const minConsDevPct = Math.max(0, Number(url.searchParams.get('minConsDevPct')) || 0);
    const consMinStr = url.searchParams.get('consensusMin');
    const consMaxStr = url.searchParams.get('consensusMax');
    const consMin = consMinStr ? Number(consMinStr) : null;
    const consMax = consMaxStr ? Number(consMaxStr) : null;
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

    // grades by symbol, sorted by date asc — для накопительных корректировок
    // между monthly snapshot и датой события.
    const gradesBySym: Record<string, typeof allGrades> = {};
    for (const g of allGrades) (gradesBySym[g.symbol] = gradesBySym[g.symbol] || []).push(g);
    for (const sym of Object.keys(gradesBySym)) {
      gradesBySym[sym].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
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

      // === Гибридный консенсус ===
      // 1) Берём последний FMP-снимок с датой ≤ event.date (FMP даёт месячные).
      // 2) Из counts (strongBuy/buy/hold/sell/strongSell) считаем «базу».
      // 3) Применяем все grade-события для этого тикера в (snapshot_date, event.date):
      //    previousGrade → counts[previousGrade] -= 1
      //    newGrade      → counts[newGrade] += 1
      // 4) Пересчитываем consensus_score из обновлённых counts.
      const consList = consBySym[g.symbol] || [];
      let bestC: typeof consList[number] | null = null;
      for (const c of consList) {
        if ((c.date || '') > (g.date || '')) break;
        bestC = c;
      }

      let consScore: number | null = null;
      let consFirms: number | null = null;
      let consBaseScore: number | null = null;
      let adjustments = 0;
      let snapshotDate: string | null = null;

      if (bestC) {
        // База
        const counts: Record<number, number> = {
          5: bestC.strongBuy || 0,
          4: bestC.buy || 0,
          3: bestC.hold || 0,
          2: bestC.sell || 0,
          1: bestC.strongSell || 0,
        };
        let total = counts[5] + counts[4] + counts[3] + counts[2] + counts[1];
        consBaseScore = total > 0
          ? (5 * counts[5] + 4 * counts[4] + 3 * counts[3] + 2 * counts[2] + 1 * counts[1]) / total
          : null;
        snapshotDate = bestC.date || null;

        // Корректировки из grades между snapshotDate (исключительно) и event.date (исключительно)
        const snap = bestC.date || '';
        const gradesList = gradesBySym[g.symbol] || [];
        for (const og of gradesList) {
          const od = og.date || '';
          if (od <= snap) continue;             // уже в снимке
          if (od >= (g.date || '')) break;      // после или равно текущему событию — пропускаем
          const newR = normalizeRating(og.newGrade);
          const oldR = normalizeRating(og.previousGrade);
          if (oldR != null && counts[oldR] != null) {
            counts[oldR] = Math.max(0, counts[oldR] - 1);
            total = Math.max(0, total - 1);
          }
          if (newR != null && counts[newR] != null) {
            counts[newR] += 1;
            total += 1;
          }
          if (newR != null || oldR != null) adjustments++;
        }

        consScore = total > 0
          ? (5 * counts[5] + 4 * counts[4] + 3 * counts[3] + 2 * counts[2] + 1 * counts[1]) / total
          : null;
        consFirms = total;
        if (consScore != null) consFromFmp++;
        else consMissing++;
      } else {
        consMissing++;
      }
      // Отклонение нового рейтинга от консенсуса в процентах (от значения консенсуса).
      // deviationPct > 0 ⇒ новый рейтинг выше консенсуса (бычьее).
      // deviationPct < 0 ⇒ новый рейтинг ниже консенсуса (медвежее).
      const deviationPct = (consScore != null && consScore > 0)
        ? ((newN - consScore) / consScore) * 100
        : null;
      const below = consScore != null && newN < consScore ? 1 : 0;
      const above = consScore != null && newN > consScore ? 1 : 0;

      if (consensus === 'below') {
        if (!below) continue;
        if (deviationPct == null || -deviationPct < minConsDevPct) continue; // нужен скачок ≥ N% вниз
      }
      if (consensus === 'above') {
        if (!above) continue;
        if (deviationPct == null || deviationPct < minConsDevPct) continue; // нужен скачок ≥ N% вверх
      }
      // consensus === 'any' — отклонение не используем

      // Фильтр по абсолютному значению консенсуса (1..5).
      if (consMin != null) {
        if (consScore == null || consScore < consMin) continue;
      }
      if (consMax != null) {
        if (consScore == null || consScore > consMax) continue;
      }

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
        consensusBaseScore: consBaseScore,
        consensusAdjustments: adjustments,
        consensusSnapshotDate: snapshotDate,
        consDeviationPct: deviationPct,
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
