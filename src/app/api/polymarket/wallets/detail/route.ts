import { NextResponse } from 'next/server';
import { loadBets } from '@/lib/polymarket/walletStore';
import { openPositions } from '@/lib/polymarket/walletData';
import { logAppError } from '@/lib/app-errors';

// Детальная карточка кошелька:
//  - all: все разрешённые сделки (события из БД) с показателями;
//  - open: текущие активные (неразрешённые) позиции, живьём с data-api.

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const address = String(sp.get('address') || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return NextResponse.json({ error: 'bad address' }, { status: 400 });
    }
    const bets = await loadBets(address);
    bets.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
    let open: Awaited<ReturnType<typeof openPositions>> = [];
    try { open = await openPositions(address); } catch { /* живые позиции недоступны — не критично */ }
    return NextResponse.json({ address, bets, open });
  } catch (e: any) {
    await logAppError({ route: '/api/polymarket/wallets/detail', message: e?.message || 'detail failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ error: e?.message || 'detail failed' }, { status: 500 });
  }
}
