import { NextRequest, NextResponse } from 'next/server';
import { buildInvestorDetail, defaultWindow } from '@/lib/superinvestor/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/superinvestor/<slug>?years=3[&full=1]
//
// full=1 — включить матрицу цен (нужна странице бэктеста для клиентского пересчёта).
// Иначе матрица вырезается, чтобы не гонять лишние данные.
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const yearsParam = parseInt(url.searchParams.get('years') || '3', 10);
  const years = [1, 3, 5].includes(yearsParam) ? yearsParam : 3;
  const full = url.searchParams.get('full') === '1';
  const win = defaultWindow(years);

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
