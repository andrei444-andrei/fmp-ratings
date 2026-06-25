import { NextResponse } from 'next/server';
import { listForecasts, listFetchLog } from '@/lib/forecasts/store';
import { logAppError } from '@/lib/app-errors';

// GET /api/forecasts/data — кэш прогнозов из БД (сами по (актив×год)) + лог
// запросов. Факт. доходность и кварталы клиент берёт из синтетики (пока нет
// ключей цен). Прогнозы — реальные из кэша Sonar/ручные.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [forecasts, fetchLog] = await Promise.all([listForecasts(), listFetchLog()]);
    return NextResponse.json({ forecasts, fetchLog });
  } catch (e: any) {
    await logAppError({ route: '/api/forecasts/data', message: e?.message || 'data failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ forecasts: [], fetchLog: [], error: e?.message || 'data failed' }, { status: 500 });
  }
}
