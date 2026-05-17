import { NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';

// Список символов, по которым уже есть consensus_history (для инкрементальной фазы).
export async function GET() {
  try {
    const res = await libsqlClient.execute('SELECT DISTINCT symbol FROM consensus_history');
    const symbols = res.rows.map((r: any) => r[0] as string);
    return NextResponse.json(symbols);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
