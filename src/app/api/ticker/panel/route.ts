import { getTickerPanel } from '@/lib/ticker/panel';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Панель одного тикера: дневной ряд + факторы (на входе) + форвард-доходности по горизонтам.
// Кэш-первым через getPrices; без ключей — синтетика. Условия/бины/статистика считаются на клиенте.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  try {
    if (!symbol) return Response.json({ ok: false, error: 'no symbol' }, { status: 400 });
    const panel = await getTickerPanel(symbol);
    return Response.json(panel);
  } catch (e: any) {
    logAppError({ route: '/api/ticker/panel', message: e?.message || String(e), stack: e?.stack, meta: { symbol } }).catch(() => {});
    return Response.json({ ok: false, error: 'compute failed', symbol }, { status: 200 });
  }
}
