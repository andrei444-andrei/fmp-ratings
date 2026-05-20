import { NextRequest, NextResponse } from 'next/server';
import { callGdeltRaw, type GdeltRawRequest } from '@/lib/gdelt';

// POST /api/gdelt/debug
// body: { query, mode?, format?, maxrecords?, sort?, timespan?, startDate?, endDate?, extra? }
// Возвращает: { url, status, contentType, body }
export async function POST(req: NextRequest) {
  try {
    const j = await req.json();
    const query = j?.query;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    const extra: Record<string, string> = {};
    if (j?.extra && typeof j.extra === 'object') {
      for (const [k, v] of Object.entries(j.extra)) {
        if (v == null) continue;
        extra[String(k)] = String(v);
      }
    }
    const reqObj: GdeltRawRequest = {
      query,
      mode: typeof j.mode === 'string' ? j.mode : undefined,
      format: typeof j.format === 'string' ? j.format : undefined,
      maxrecords: j.maxrecords != null ? String(j.maxrecords) : undefined,
      sort: typeof j.sort === 'string' ? j.sort : undefined,
      timespan: typeof j.timespan === 'string' && j.timespan.trim() ? j.timespan.trim() : undefined,
      startDate: typeof j.startDate === 'string' && j.startDate ? j.startDate : undefined,
      endDate: typeof j.endDate === 'string' && j.endDate ? j.endDate : undefined,
      extra: Object.keys(extra).length ? extra : undefined,
    };
    const result = await callGdeltRaw(reqObj);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
