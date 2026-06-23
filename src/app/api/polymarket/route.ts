import { NextResponse } from 'next/server';
import { buildPayload } from '@/lib/polymarket/source';
import { cacheGet, cacheSet } from '@/lib/polymarket/cache';
import { logAppError } from '@/lib/app-errors';

// Живые данные Polymarket для страницы /polymarket:
// широкий охват (макро/индексы/мегакапы/компании/крипто/сырьё),
// детект смены закономерностей по почасовой истории и перевод вопросов на русский.
// Тяжёлая сборка кэшируется в Turso на 15 минут; ?force=1 — пересобрать.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_KEY = 'polymarket:v2';
const TTL_MS = 15 * 60 * 1000;

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1';
  try {
    if (!force) {
      const cached = await cacheGet(CACHE_KEY, TTL_MS);
      if (cached) return NextResponse.json({ ...cached, cached: true });
    }
    const payload = await buildPayload();
    await cacheSet(CACHE_KEY, payload);
    return NextResponse.json({ ...payload, cached: false });
  } catch (e: any) {
    await logAppError({
      route: '/api/polymarket',
      message: e?.message || 'fetch failed',
      stack: e?.stack ?? null,
    }).catch(() => {});
    // последний шанс — отдать устаревший кэш, чтобы страница не была пустой
    const stale = await cacheGet(CACHE_KEY, Number.MAX_SAFE_INTEGER).catch(() => null);
    if (stale) return NextResponse.json({ ...stale, cached: true, stale: true });
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 502 });
  }
}
