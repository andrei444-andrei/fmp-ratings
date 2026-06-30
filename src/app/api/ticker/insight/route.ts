import { getTickerInsight } from '@/lib/ticker/insight';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Контентный слой «картина акции»: профиль-досье, грейды sell-side (история), консенсус-таргет,
// фундаментал в динамике, лента новостей. Кэш-первым через коннекторы; без ключей — пусто (graceful).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  try {
    if (!symbol) return Response.json({ ok: false, error: 'no symbol' }, { status: 400 });
    const insight = await getTickerInsight(symbol);
    return Response.json({ ok: true, ...insight });
  } catch (e: any) {
    logAppError({ route: '/api/ticker/insight', message: e?.message || String(e), stack: e?.stack, meta: { symbol } }).catch(() => {});
    return Response.json({ ok: false, error: 'insight failed', symbol, profile: null, grades: [], target: null, income: [], news: [] }, { status: 200 });
  }
}
