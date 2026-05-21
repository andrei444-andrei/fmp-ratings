import { NextRequest, NextResponse } from 'next/server';
import { buildInvestorDetail, resolveWindow } from '@/lib/superinvestor/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/superinvestor/<slug>?years=3 | ?from=2010-01-01 [&full=1]
//
// full=1 — включить матрицу цен (нужна странице бэктеста для клиентского пересчёта).
// Иначе матрица вырезается, чтобы не гонять лишние данные.
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const full = url.searchParams.get('full') === '1';
  const win = resolveWindow(url.searchParams);

  try {
    const detail = await buildInvestorDetail(slug, win);
    if (!detail) {
      return NextResponse.json({ error: 'Нет данных 13F для инвестора в выбранном окне' }, { status: 404 });
    }
    const out = full ? detail : { ...detail, priceMatrix: { dates: [], series: {} } };
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
