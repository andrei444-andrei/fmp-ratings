import { NextRequest, NextResponse } from 'next/server';
import { ingestForecasts, type IngestTarget } from '@/lib/forecasts/ingest';
import { friendlyWriteError } from '@/lib/db-write-guard';
import { logAppError } from '@/lib/app-errors';
import { YEARS } from '@/app/forecasts/mock';

// POST /api/forecasts/ingest — добрать прогнозы для непокрытых ячеек через
// Sonar (или синтетика без ключа). Обрабатывает не более `limit` ячеек за вызов
// (serverless-таймаут) и возвращает остаток — клиент вызывает повторно до 0.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const targets: IngestTarget[] | undefined = Array.isArray(body?.targets)
      ? body.targets.filter((t: any) => t && typeof t.asset === 'string' && Number.isInteger(t.year))
      : undefined;
    const years: number[] = Array.isArray(body?.years) && body.years.length ? body.years.map(Number) : YEARS;
    const limit = Number.isInteger(body?.limit) ? Math.max(1, Math.min(8, body.limit)) : 4;
    const force = !!body?.force;

    const result = await ingestForecasts({ targets, years, force, limit });
    return NextResponse.json(result);
  } catch (e: any) {
    await logAppError({ route: '/api/forecasts/ingest', message: e?.message || 'ingest failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ error: friendlyWriteError(e) }, { status: 500 });
  }
}
