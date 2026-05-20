import { NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';
import { DDL_STATEMENTS } from '@/db/ddl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    for (const sql of DDL_STATEMENTS) await libsqlClient.execute(sql);
    return NextResponse.json({ ok: true, applied: DDL_STATEMENTS.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
