import { getIndicatorById, getEarningsBySymbol } from '@/lib/terminal/indicator-history';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// История показателя за несколько лет (для всплывашки радара): ?id=<значимый тип> | ?symbol=<тикер>.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const symbol = url.searchParams.get('symbol');
  try {
    if (symbol) {
      const data = await getEarningsBySymbol(symbol);
      return Response.json(data, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=43200' } });
    }
    if (id) {
      const data = await getIndicatorById(id);
      if (!data) return Response.json({ error: 'unknown indicator' }, { status: 404 });
      return Response.json(data, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=43200' } });
    }
    return Response.json({ error: 'id or symbol required' }, { status: 400 });
  } catch (e: any) {
    await logAppError({ route: '/api/market/indicator', message: e?.message || 'indicator failed', stack: e?.stack });
    return Response.json({ error: e?.message || 'indicator failed' }, { status: 500 });
  }
}
