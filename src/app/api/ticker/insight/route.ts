import { getTickerInsight } from '@/lib/ticker/insight';
import { fmpPeers, fmpRatiosTtm } from '@/lib/fmp';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Контентный слой «картина акции»: профиль-досье, грейды sell-side (история), консенсус-таргет,
// фундаментал в динамике, лента новостей. Кэш-первым через коннекторы; без ключей — пусто (graceful).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  // ?refresh=1 — принудительно обойти кэш свежести и перетянуть данные из FMP (напр. после смены схемы метрик).
  const force = /^(1|true|yes)$/i.test(url.searchParams.get('refresh') || '');
  try {
    if (!symbol) return Response.json({ ok: false, error: 'no symbol' }, { status: 400 });
    // ВРЕМЕННО: диагностика сырых форм ответов FMP для пиров/ratios-ttm.
    if (url.searchParams.get('debug') === 'peers') {
      const [peersRaw, ratRaw] = await Promise.all([
        fmpPeers(symbol).catch((e) => ({ __error: String(e?.message || e) })),
        fmpRatiosTtm(symbol).catch((e) => ({ __error: String(e?.message || e) })),
      ]);
      const rat0 = Array.isArray(ratRaw) ? ratRaw[0] : ratRaw;
      return Response.json({ peersRaw, ratiosTtmKeys: rat0 && typeof rat0 === 'object' ? Object.keys(rat0) : rat0, ratiosTtmSample: rat0 });
    }
    const insight = await getTickerInsight(symbol, force);
    return Response.json({ ok: true, ...insight });
  } catch (e: any) {
    logAppError({ route: '/api/ticker/insight', message: e?.message || String(e), stack: e?.stack, meta: { symbol } }).catch(() => {});
    return Response.json({ ok: false, error: 'insight failed', symbol, profile: null, grades: [], target: null, income: [], news: [] }, { status: 200 });
  }
}
