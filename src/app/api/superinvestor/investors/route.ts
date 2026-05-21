import { NextRequest, NextResponse } from 'next/server';
import { INVESTORS } from '@/lib/superinvestor/registry';
import { getCustomInvestors, addInvestor, removeInvestor } from '@/lib/superinvestor/investors-store';

export const dynamic = 'force-dynamic';

// GET    /api/superinvestor/investors           — { builtin, custom }
// POST   /api/superinvestor/investors { ... }    — добавить кастомного
// DELETE /api/superinvestor/investors?slug=...    — удалить кастомного
export async function GET() {
  return NextResponse.json({ builtin: INVESTORS, custom: await getCustomInvestors() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { investor, error } = await addInvestor(body);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ investor, custom: await getCustomInvestors() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const slug = new URL(req.url).searchParams.get('slug') || '';
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
    const { error } = await removeInvestor(slug);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ custom: await getCustomInvestors() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
