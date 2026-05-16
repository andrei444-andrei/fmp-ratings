import { NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';

// GET /api/read/grades-symbols
// Возвращает массив уникальных symbol'ов, по которым уже есть grades в DB.
export async function GET() {
  try {
    const res = await libsqlClient.execute('SELECT DISTINCT symbol FROM grades');
    const symbols = res.rows.map((r: any) => r[0] as string);
    return NextResponse.json(symbols);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
