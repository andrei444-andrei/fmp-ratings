import { suggestPortfolioName } from '@/lib/research/portfolioNaming';
import { listPortfolios, type ExecMode, type Parking } from '@/lib/research/portfolios';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// AI-имя теста (портфеля) по составу/механике/метрикам — для автосохранения после запуска.
// Без ключа AIMLAPI → 503 (UI подставит запасное детерминированное имя).
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({} as any));
    const setups = Array.isArray(b?.setups) ? b.setups.map((x: any) => String(x)).filter(Boolean) : [];
    if (!setups.length) return Response.json({ error: 'нет сетапов' }, { status: 400 });
    if (!process.env.AIMLAPI_KEY) return Response.json({ error: 'AI-имя недоступно — не настроен AIMLAPI_KEY' }, { status: 503 });

    const execution: ExecMode = b?.execution === 'weekly' ? 'weekly' : b?.execution === 'monthly' ? 'monthly' : 'ladder';
    const parking: Parking = b?.parking === 'SPY' ? 'SPY' : b?.parking === 'CASH' ? 'CASH' : 'BIL';
    const existing = (await listPortfolios().catch(() => [])).map((p) => p.name);

    const title = await suggestPortfolioName({
      setups, execution, ladderN: Number(b?.ladderN) || 5, parking,
      metrics: b?.metrics && typeof b.metrics === 'object' ? b.metrics : undefined,
      existing,
    });
    if (!title) return Response.json({ error: 'не удалось предложить имя' }, { status: 502 });
    return Response.json({ title });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/portfolios/suggest-name', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 502 });
  }
}
