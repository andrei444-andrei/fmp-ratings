import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';

export const runtime = 'nodejs';

// POST — полностью очищает таблицу consensus_history.
// После этого нужно заново запустить pipeline (Phase 2.5 тогда подтянет
// свежие данные для всех символов, потому что cache будет пуст).
export async function POST() {
  try {
    await db.delete(schema.consensusHistory);
    return NextResponse.json({ ok: true, wiped: 'consensus_history' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
