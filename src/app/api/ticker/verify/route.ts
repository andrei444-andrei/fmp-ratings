import { NextRequest, NextResponse } from 'next/server';
import { filterValidSymbols } from '@/lib/symbol-directory';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// POST /api/ticker/verify  { symbols: ["AAPL","CEO"] } → { valid: ["AAPL"] }
// Возвращает подмножество кандидатов, являющихся реальными тикерами.
// При любой ошибке отдаёт { valid: [] } — клиент рендерит текст без ссылок.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const symbols: string[] = Array.isArray(body?.symbols) ? body.symbols.map((s: any) => String(s)) : [];
    if (!symbols.length) return NextResponse.json({ valid: [] });
    const valid = await filterValidSymbols(symbols);
    return NextResponse.json({ valid });
  } catch (e: any) {
    console.error('[api/ticker/verify]', e);
    return NextResponse.json({ valid: [] });
  }
}
