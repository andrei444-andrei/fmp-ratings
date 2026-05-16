import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { normalizeRating, labelFor } from '@/lib/rating';

// POST { minJump?: number }
// Читает grades + top_n_per_year, для каждой grade-записи определяет year и
// проверяет членство symbol ∈ top_n_per_year[year]. Применяет фильтр (newRating
// ∈ {Buy, SB}, delta ≥ minJump). Перезаписывает rating_changes_filtered.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const minJump = Math.max(1, Number(body.minJump) || 2);

    const topRows = await db.select().from(schema.topNPerYear);
    if (!topRows.length) {
      return NextResponse.json({ error: 'top_n_per_year пуст — сначала запустите pipeline' }, { status: 400 });
    }
    const membership: Record<number, Set<string>> = {};
    for (const r of topRows) {
      (membership[r.year] = membership[r.year] || new Set()).add(r.symbol);
    }

    const allGrades = await db.select().from(schema.grades);
    const out: any[] = [];
    const now = new Date().toISOString();
    for (const g of allGrades) {
      const year = parseInt((g.date || '').slice(0, 4));
      if (!year || !membership[year]) continue;
      if (!membership[year].has(g.symbol)) continue;
      const newN = normalizeRating(g.newGrade);
      const oldN = normalizeRating(g.previousGrade);
      if (newN == null || oldN == null) continue;
      if (newN < 4) continue;
      const jump = newN - oldN;
      if (jump < minJump) continue;
      out.push({
        year,
        date: g.date,
        symbol: g.symbol,
        newRating: labelFor(newN),
        previousRating: labelFor(oldN),
        newGradeRaw: g.newGrade,
        previousGradeRaw: g.previousGrade,
        gradingCompany: g.gradingCompany,
        action: g.action,
        jumpSize: jump,
        minJump,
        computedAt: now,
      });
    }
    out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    await db.delete(schema.ratingChangesFiltered);
    const CHUNK = 500;
    for (let i = 0; i < out.length; i += CHUNK) {
      await db.insert(schema.ratingChangesFiltered).values(out.slice(i, i + CHUNK));
    }
    return NextResponse.json({ inserted: out.length, minJump });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
