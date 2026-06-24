import { NextResponse } from 'next/server';
import { listWallets, progress, resetScored } from '@/lib/polymarket/walletStore';
import { crawlBatch } from '@/lib/polymarket/walletCrawl';
import { logAppError } from '@/lib/app-errors';

// «Умные деньги» Polymarket.
//  GET  — лидерборд кошельков по edge-статистике (+ фильтры) и прогресс краула.
//  POST — батч-краул (дискавери + скоринг пачки), резюмируемый. Тяжёлый → bounded.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const wallets = await listWallets({
      category: sp.get('category') || 'all',
      minN: sp.get('minN') ? Number(sp.get('minN')) : undefined,
      sigOnly: sp.get('sigOnly') === '1',
      minHorizon: sp.get('minHorizon') ? Number(sp.get('minHorizon')) : 30,
      limit: sp.get('limit') ? Number(sp.get('limit')) : 100,
    });
    return NextResponse.json({ wallets, progress: await progress() });
  } catch (e: any) {
    await logAppError({ route: '/api/polymarket/wallets', message: e?.message || 'list failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ error: e?.message || 'list failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const body = await req.json().catch(() => ({}));
    if (sp.get('reset') === '1' || body.reset === true) {
      await resetScored();
      return NextResponse.json({ reset: true, progress: await progress() });
    }
    const res = await crawlBatch({
      discover: sp.get('discover') === '1' || body.discover === true,
      discoverMarkets: body.discoverMarkets ?? 40,
      holdersPer: body.holdersPer ?? 60,
      scoreWallets: body.scoreWallets ?? 60,
      minHorizonDays: body.minHorizonDays ?? 30,
      minN: body.minN ?? 20,
      budgetMs: body.budgetMs ?? 45000,
    });
    return NextResponse.json(res);
  } catch (e: any) {
    await logAppError({ route: '/api/polymarket/wallets[POST]', message: e?.message || 'crawl failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ error: e?.message || 'crawl failed' }, { status: 500 });
  }
}
