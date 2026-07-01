import { getTickerInsight } from '@/lib/ticker/insight';
import { getFmpKey } from '@/lib/fmp';
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
    // ВРЕМЕННО: диагностика сырых форм ответов FMP (какой эндпоинт пиров жив + ключи key-metrics-ttm).
    if (url.searchParams.get('debug') === 'peers') {
      const key = getFmpKey();
      const tryEp = async (path: string) => {
        try {
          const r = await fetch(`https://financialmodelingprep.com/stable/${path}&apikey=${encodeURIComponent(key)}`, { cache: 'no-store' });
          const t = await r.text();
          return { status: r.status, body: t.slice(0, 500) };
        } catch (e: any) { return { err: String(e?.message || e) }; }
      };
      const [peers, stockPeers, kmTtm] = await Promise.all([
        tryEp(`peers?symbol=${symbol}`),
        tryEp(`stock-peers?symbol=${symbol}`),
        tryEp(`key-metrics-ttm?symbol=${symbol}`),
      ]);
      let kmKeys: any = null;
      try { const arr = JSON.parse(kmTtm.body || 'null'); const o = Array.isArray(arr) ? arr[0] : arr; kmKeys = o && typeof o === 'object' ? Object.keys(o) : o; } catch {}
      return Response.json({ peers, stockPeers, kmTtmKeys: kmKeys });
    }
    const insight = await getTickerInsight(symbol, force);
    return Response.json({ ok: true, ...insight });
  } catch (e: any) {
    logAppError({ route: '/api/ticker/insight', message: e?.message || String(e), stack: e?.stack, meta: { symbol } }).catch(() => {});
    return Response.json({ ok: false, error: 'insight failed', symbol, profile: null, grades: [], target: null, income: [], news: [] }, { status: 200 });
  }
}
