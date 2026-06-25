import { NextRequest, NextResponse } from 'next/server';
import { ingestForecasts } from '@/lib/forecasts/ingest';
import { YEARS } from '@/app/forecasts/mock';
import { logAppError } from '@/lib/app-errors';

// Фоновый добор прогнозов (Vercel Cron). Каждый тик добирает пустые ячейки
// МАЛЫМИ батчами в пределах временного бюджета (<60с serverless-лимита) — так
// матрица наполняется сама, без клиентского цикла и без таймаутов.
// Когда все ячейки уже искали — тик дешёвый (ingestForecasts вернёт processed=0).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Pro даёт запас; на Hobby режется до 60с — батч укладывается

// Защита: пускаем либо Vercel Cron (заголовок x-vercel-cron, внешне подделать
// нельзя — Vercel выставляет его сам), либо ручной вызов с Bearer CRON_SECRET.
function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Новый батч стартуем только если прошло <25с — так за тик влезает максимум
  // один «медленный» батч (~50с) или пара быстрых; всё под 60с-лимитом Hobby.
  const deadlineMs = 25_000;
  const t0 = Date.now();
  let processed = 0, found = 0, remaining = 0, mode = '';
  try {
    while (Date.now() - t0 < deadlineMs) {
      const res = await ingestForecasts({ years: YEARS, limit: 2 });
      processed += res.processed; found += res.found; remaining = res.remaining; mode = res.mode;
      if (res.processed === 0 || res.remaining <= 0) break;
    }
    return NextResponse.json({ ok: true, processed, found, remaining, mode, ms: Date.now() - t0 });
  } catch (e: any) {
    await logAppError({ route: '/api/forecasts/cron', message: e?.message || 'cron failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ ok: false, processed, found, error: e?.message || 'cron failed' }, { status: 500 });
  }
}
