import { NextRequest, NextResponse } from 'next/server';
import { callMarketaux, type MarketauxEndpoint } from '@/lib/marketaux';

const ALLOWED: MarketauxEndpoint[] = [
  '/news/all', '/news/by-uuid', '/news/similar', '/news/sources',
  '/entity/search', '/entity/stats', '/entity/stats/intraday',
  '/entity/stats/aggregation', '/entity/type/list', '/entity/industry/list',
];

// POST /api/marketaux/debug
// body: { endpoint: '/news/all', uuid?: string, params: Record<string,string> }
// Возвращает: { url (masked), status, contentType, body, rateLimit }
export async function POST(req: NextRequest) {
  try {
    const j = await req.json();
    const endpoint = j?.endpoint;
    if (!ALLOWED.includes(endpoint)) {
      return NextResponse.json(
        { error: `endpoint must be one of: ${ALLOWED.join(', ')}` },
        { status: 400 }
      );
    }
    const uuid = typeof j?.uuid === 'string' ? j.uuid : undefined;
    if ((endpoint === '/news/by-uuid' || endpoint === '/news/similar') && !uuid) {
      return NextResponse.json(
        { error: `endpoint ${endpoint} requires uuid` },
        { status: 400 }
      );
    }
    const params: Record<string, string> = {};
    if (j?.params && typeof j.params === 'object') {
      for (const [k, v] of Object.entries(j.params)) {
        if (v == null) continue;
        params[String(k)] = String(v);
      }
    }
    const result = await callMarketaux({ endpoint, uuid, params });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
