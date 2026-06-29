import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Дневные цены закрытия по набору тикеров — для графиков сделок (линия цены актива + периоды сделок).
// Кэш-первым через getPrices; без ключей (e2e/демо) — детерминированная синтетика (как в screenPanel).
// Ряд даунсэмплится до ~700 точек: линия не требует каждого тика, а периоды сделок рисуются по датам.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const symbols = (Array.isArray(body?.symbols) ? body.symbols : [])
      .map((s: any) => String(s).toUpperCase().trim()).filter(Boolean).slice(0, 40) as string[];
    if (!symbols.length) return Response.json({ series: {} });
    const to = new Date().toISOString().slice(0, 10);
    const from = String(body?.from || new Date(Date.now() - 25 * 365 * 864e5).toISOString().slice(0, 10)).slice(0, 10);

    const series: Record<string, { date: string; close: number }[]> = {};
    const uniq = [...new Set(symbols)];
    for (let i = 0; i < uniq.length; i += 6) {
      await Promise.all(uniq.slice(i, i + 6).map(async (sym) => {
        let rows = await getPrices(sym, from, to).catch(() => [] as { date: string; close: number }[]);
        if (rows.length < 5) rows = syntheticSeries(sym);
        const win = rows.filter((r) => r.date >= from && r.date <= to);
        const src = win.length ? win : rows;
        const stride = Math.max(1, Math.ceil(src.length / 700));
        const out: { date: string; close: number }[] = [];
        for (let j = 0; j < src.length; j += stride) out.push({ date: src[j].date, close: src[j].close });
        const last = src[src.length - 1];
        if (last && out[out.length - 1]?.date !== last.date) out.push({ date: last.date, close: last.close });
        series[sym] = out;
      }));
    }
    return Response.json({ series });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/prices', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ series: {} }); // graceful — график просто покажет «нет цен»
  }
}
