import { NextResponse } from 'next/server';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from '@/db/client';
import path from 'node:path';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    const folder = path.join(process.cwd(), 'drizzle');
    await migrate(db, { migrationsFolder: folder });
    return NextResponse.json({ ok: true, message: 'Миграции применены' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}
