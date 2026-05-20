import { NextRequest, NextResponse } from 'next/server';
import { INVESTORS } from '@/lib/superinvestor/registry';
import { buildLeaderboardRow, defaultWindow } from '@/lib/superinvestor/service';
import { siCacheGet } from '@/lib/superinvestor/cache';
import type { LeaderboardRow } from '@/lib/superinvestor/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/superinvestor/leaderboard?years=3
//
// Возвращает { rows, pending, window, error? }. Тяжёлый холодный расчёт идёт с
// бюджетом времени: что не успели — попадает в pending, клиент дозапрашивает.
// Тёплый кэш отдаётся мгновенно.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const yearsParam = parseInt(url.searchParams.get('years') || '3', 10);
  const years = [1, 3, 5].includes(yearsParam) ? yearsParam : 3;
  const win = defaultWindow(years);

  const budgetMs = 45000;
  const start = Date.now();
  const rows: LeaderboardRow[] = [];
  const pending: string[] = [];
  let firstErr: string | undefined;

  for (const inv of INVESTORS) {
    const cached = await siCacheGet<LeaderboardRow>(`row|${inv.slug}|${win.from}|${win.to}`);
    if (cached) { rows.push(cached); continue; }
    if (Date.now() - start > budgetMs) { pending.push(inv.slug); continue; }
    try {
      const row = await buildLeaderboardRow(inv.slug, win);
      if (row) rows.push(row);
      // null = нет данных 13F (постоянный промах) — не ставим в pending
    } catch (e: any) {
      if (!firstErr) firstErr = e?.message || String(e);
      pending.push(inv.slug);
    }
  }

  rows.sort((a, b) => b.alphaPct - a.alphaPct);

  // Глобальная ошибка (например, нет ключа FMP) — все упали, ничего не отдать.
  const error = rows.length === 0 && firstErr ? firstErr : undefined;
  return NextResponse.json({ rows, pending, window: win, years, total: INVESTORS.length, error });
}
