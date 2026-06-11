import { NextRequest, NextResponse } from 'next/server';
import { getCredsStatus, saveCreds, clearCreds } from '@/lib/quantconnect/creds';
import { qcAuthenticate } from '@/lib/quantconnect/client';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET  /api/quantconnect/credentials          → статус (без токена)
// GET  /api/quantconnect/credentials?test=1   → + проверка авторизации
// POST /api/quantconnect/credentials          → сохранить { userId, apiToken, organizationId? } + проверка
// DELETE /api/quantconnect/credentials        → удалить
export async function GET(req: NextRequest) {
  try {
    const status = await getCredsStatus();
    if (status.configured && new URL(req.url).searchParams.get('test')) {
      try {
        status.authenticated = await qcAuthenticate();
        status.authError = null;
      } catch (e: any) {
        status.authenticated = false;
        status.authError = e?.message || String(e);
      }
    }
    return NextResponse.json(status);
  } catch (e: any) {
    return NextResponse.json({ configured: false, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await saveCreds({ userId: body.userId, apiToken: body.apiToken, organizationId: body.organizationId });
    const status = await getCredsStatus();
    try {
      status.authenticated = await qcAuthenticate();
      status.authError = null;
    } catch (e: any) {
      status.authenticated = false;
      status.authError = e?.message || String(e);
    }
    return NextResponse.json(status);
  } catch (e: any) {
    await logAppError({ route: '/api/quantconnect/credentials', message: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    await clearCreds();
    return NextResponse.json({ configured: false });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
