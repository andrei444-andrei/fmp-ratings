import { NextRequest, NextResponse } from 'next/server';
import { callNewsApiAi, type NewsApiAiEndpoint } from '@/lib/newsapi-ai';

const ALLOWED: NewsApiAiEndpoint[] = [
  '/event/getEvents', '/event/getEvent', '/article/getArticles',
  '/suggestConceptsFast', '/suggestCategoriesFast', '/suggestSourcesFast',
];

// POST /api/newsapi-ai/debug
// body: { endpoint, params }
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
    const params: Record<string, string> = {};
    if (j?.params && typeof j.params === 'object') {
      for (const [k, v] of Object.entries(j.params)) {
        if (v == null) continue;
        params[String(k)] = String(v);
      }
    }
    const result = await callNewsApiAi({ endpoint, params });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
