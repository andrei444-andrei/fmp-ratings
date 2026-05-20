import { NextRequest, NextResponse } from 'next/server';
import { listEvents, countEvents, clearEvents } from '@/lib/events-db';

// GET    /api/ai/events-db/events?from=&to=&category=&limit=&offset=&countOnly=1
// DELETE /api/ai/events-db/events  — очистить всю базу собранных событий
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const stats = await countEvents();
    if (sp.get('countOnly') === '1') {
      return NextResponse.json({ stats });
    }
    const events = await listEvents({
      from: sp.get('from') || undefined,
      to: sp.get('to') || undefined,
      category: sp.get('category') || undefined,
      limit: sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined,
      offset: sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined,
    });
    return NextResponse.json({ events, stats });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await clearEvents();
    return NextResponse.json({ ok: true, stats: await countEvents() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
