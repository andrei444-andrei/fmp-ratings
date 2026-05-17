import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { normalizeRating, labelFor } from '@/lib/rating';

// POST { minJump?, belowConsensusOnly?, lookbackDays? }
// Phase 3: фильтр накопленных grades. Консенсус берётся из таблицы
// consensus_history (FMP grades-historical) — точный point-in-time срез.
// Если на дату события записи нет — fallback на вычисление из grades.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const minJump = Math.max(1, Number(body.minJump) || 2);
    const belowConsensusOnly = !!body.belowConsensusOnly;
    const lookbackDays = Math.max(1, Number(body.lookbackDays) || 365);

    const topRows = await db.select().from(schema.topNPerYear);
    if (!topRows.length) {
      return NextResponse.json({ error: 'top_n_per_year пуст — сначала запустите pipeline' }, { status: 400 });
    }
    const membership: Record<number, Set<string>> = {};
    for (const r of topRows) {
      (membership[r.year] = membership[r.year] || new Set()).add(r.symbol);
    }

    const allGrades = await db.select().from(schema.grades);
    const allConsensus = await db.select().from(schema.consensusHistory);

    // grades по symbol, отсортированы по date asc
    const gradesBySym: Record<string, typeof allGrades> = {};
    for (const g of allGrades) (gradesBySym[g.symbol] = gradesBySym[g.symbol] || []).push(g);
    for (const sym of Object.keys(gradesBySym)) {
      gradesBySym[sym].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }

    // consensus по symbol, отсортирован по date asc
    const consensusBySym: Record<string, typeof allConsensus> = {};
    for (const c of allConsensus) (consensusBySym[c.symbol] = consensusBySym[c.symbol] || []).push(c);
    for (const sym of Object.keys(consensusBySym)) {
      consensusBySym[sym].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }

    const out: any[] = [];
    const now = new Date().toISOString();
    let totalEvents = 0, passedRatingAndJump = 0;
    let consensusFromFmp = 0, consensusFromGrades = 0, consensusNone = 0;
    let belowCount = 0, aboveCount = 0;

    for (const g of allGrades) {
      totalEvents++;
      const year = parseInt((g.date || '').slice(0, 4));
      if (!year || !membership[year]) continue;
      if (!membership[year].has(g.symbol)) continue;
      const newN = normalizeRating(g.newGrade);
      const oldN = normalizeRating(g.previousGrade);
      if (newN == null || oldN == null) continue;
      if (newN < 4) continue;
      const jump = newN - oldN;
      if (jump < minJump) continue;
      passedRatingAndJump++;

      const eventDate = g.date || '';

      // === A) консенсус из FMP grades-historical ===
      let consensus: number | null = null;
      let firmCount: number | null = null;
      let source = 'none';

      const consList = consensusBySym[g.symbol] || [];
      // ищем последнюю запись с date <= eventDate
      let bestC: typeof consList[number] | null = null;
      for (const c of consList) {
        if ((c.date || '') > eventDate) break;
        bestC = c;
      }
      if (bestC && bestC.consensusScore != null) {
        consensus = bestC.consensusScore;
        firmCount = bestC.totalAnalysts;
        source = 'fmp';
        consensusFromFmp++;
      } else {
        // === B) fallback: вычисляем из grades в окне lookbackDays ===
        const windowStart = subtractDaysIso(eventDate, lookbackDays);
        const list = gradesBySym[g.symbol] || [];
        const latestPerFirm: Map<string, { date: string; newGrade: string | null }> = new Map();
        for (const og of list) {
          const od = og.date || '';
          if (od >= eventDate) break;
          if (od < windowStart) continue;
          const firm = og.gradingCompany || '';
          if (!firm || firm === g.gradingCompany) continue;
          const cur = latestPerFirm.get(firm);
          if (!cur || od > cur.date) latestPerFirm.set(firm, { date: od, newGrade: og.newGrade });
        }
        const scores: number[] = [];
        for (const v of latestPerFirm.values()) {
          const n = normalizeRating(v.newGrade);
          if (n != null) scores.push(n);
        }
        if (scores.length) {
          consensus = scores.reduce((a, b) => a + b, 0) / scores.length;
          firmCount = scores.length;
          source = 'grades-derived';
          consensusFromGrades++;
        } else {
          consensusNone++;
        }
      }

      const below = consensus != null && newN < consensus ? 1 : 0;
      if (consensus != null) {
        if (below) belowCount++; else aboveCount++;
      }
      if (belowConsensusOnly && !below) continue;

      void source;
      out.push({
        year, date: g.date, symbol: g.symbol,
        newRating: labelFor(newN),
        previousRating: labelFor(oldN),
        newGradeRaw: g.newGrade,
        previousGradeRaw: g.previousGrade,
        gradingCompany: g.gradingCompany,
        action: g.action,
        jumpSize: jump,
        minJump,
        consensusBefore: consensus,
        consensusFirmCount: firmCount,
        belowConsensus: below,
        computedAt: now,
      });
    }
    out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    await db.delete(schema.ratingChangesFiltered);
    const CHUNK = 500;
    for (let i = 0; i < out.length; i += CHUNK) {
      await db.insert(schema.ratingChangesFiltered).values(out.slice(i, i + CHUNK));
    }
    return NextResponse.json({
      inserted: out.length,
      minJump,
      belowConsensusOnly,
      lookbackDays,
      stats: {
        totalEvents,
        passedRatingAndJump,
        consensusFromFmp,
        consensusFromGrades,
        consensusNone,
        below: belowCount,
        above: aboveCount,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}

function subtractDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate.length >= 10 ? isoDate.slice(0, 10) : isoDate);
  if (isNaN(d.getTime())) return '0000-00-00';
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
