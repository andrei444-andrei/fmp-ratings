import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/quantconnect/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/quantconnect/settings?key=combined → { key, value }
// PUT /api/quantconnect/settings { key, value }  → сохранить
export async function GET(req: NextRequest) {
  try {
    const key = (new URL(req.url).searchParams.get('key') || '').trim();
    if (!key) return NextResponse.json({ error: 'key обязателен' }, { status: 400 });
    return NextResponse.json({ key, value: await getSetting(key) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const key = String(body?.key || '').trim();
    if (!key) return NextResponse.json({ error: 'key обязателен' }, { status: 400 });
    await setSetting(key, body.value ?? null);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
