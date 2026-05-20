import { NextResponse } from 'next/server';
import { aiParseHoldings } from '@/lib/ai-parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Превращает плохо структурированный текст в позиции через aimlapi.
// Ничего не сохраняет — только предпросмотр.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text: string = String(body.text || '');
    if (!text.trim()) return NextResponse.json({ error: 'Пустой текст' }, { status: 400 });
    const holdings = await aiParseHoldings(text, body.model);
    return NextResponse.json({ holdings, count: holdings.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
