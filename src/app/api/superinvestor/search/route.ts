import { NextRequest, NextResponse } from 'next/server';
import { fmp13fList, type HolderRef } from '@/lib/superinvestor/fmp13f';
import { siCacheGet, siCacheSet } from '@/lib/superinvestor/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/superinvestor/search?q=ackman — поиск CIK по имени 13F-филера.
export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ matches: [] });

  try {
    // Полный каталог филеров кэшируем (стабилен) на сутки.
    const key = 'invlist|all';
    let list = await siCacheGet<HolderRef[]>(key);
    if (!list) {
      list = await fmp13fList();
      if (list.length) await siCacheSet(key, new Date().toISOString().slice(0, 10), list);
    }
    const matches = list
      .filter(h => h.name.toLowerCase().includes(q))
      .slice(0, 25);
    return NextResponse.json({ matches });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
