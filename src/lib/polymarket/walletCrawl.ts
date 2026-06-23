// Резюмируемый батч-краул «умных денег»:
//  1) дискавери кандидатов — холдеры топ-рынков по объёму (все категории);
//  2) скоринг следующей пачки кандидатов — edge-статистика по разрешённым пари
//     (горизонт ≥ minHorizonDays), разбивка по категориям, стоимость портфеля.
// Каждый вызов ограничен по объёму и дописывает прогресс в Turso.

import { topMarkets, marketHolders, resolvedBets, walletValue } from './walletData';
import { edgeStats, statsByCategory, type ResolvedBet } from './walletStats';
import { addCandidates, nextUnscored, markScored, upsertWallet, progress, type WalletRow } from './walletStore';

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = undefined as any; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return out;
}

export type CrawlOpts = {
  discover?: boolean;     // обновить пул кандидатов
  discoverMarkets?: number; // сколько топ-рынков взять для дискавери (×2: active+closed)
  holdersPer?: number;    // холдеров на рынок
  scoreWallets?: number;  // сколько кандидатов оценить за вызов
  minHorizonDays?: number;
  minN?: number;
};

export async function crawlBatch(opts: CrawlOpts = {}): Promise<{
  discovered: number;
  scored: number;
  smartFound: number;
  progress: { candidates: number; scored: number; smart: number };
}> {
  const minHorizon = opts.minHorizonDays ?? 7;
  const minN = opts.minN ?? 20;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  let discovered = 0;

  try {
    // 1) дискавери
    if (opts.discover) {
      const pages = Math.max(1, Math.ceil((opts.discoverMarkets ?? 30) / 100)) || 1;
      const markets = (await topMarkets(pages, true, ctrl.signal)).slice(0, opts.discoverMarkets ?? 30);
      const holderLists = await mapLimit(markets, 8, (m) => marketHolders(m.conditionId, opts.holdersPer ?? 50, ctrl.signal));
      const all = holderLists.flat().filter(Boolean);
      await addCandidates(all);
      discovered = new Set(all).size;
    }

    // 2) скоринг следующей пачки
    const batch = await nextUnscored(opts.scoreWallets ?? 25);
    let smartFound = 0;
    if (batch.length) {
      const results = await mapLimit(batch, 6, async (addr) => {
        const allBets = await resolvedBets(addr, ctrl.signal);
        const bets: ResolvedBet[] = allBets.filter((b) => b.horizonDays >= minHorizon);
        const overall = edgeStats(bets, minN);
        const byCatStats = statsByCategory(bets, minN);
        const value = await walletValue(addr, ctrl.signal);
        const byCat: WalletRow['byCat'] = {};
        for (const [k, s] of Object.entries(byCatStats)) {
          byCat[k] = { n: s.n, meanEdge: s.meanEdge, tStat: s.tStat, significant: s.significant, winRate: s.winRate, totalPnl: s.totalPnl };
        }
        return { addr, overall, byCat, value };
      });
      for (const r of results) {
        if (!r) continue;
        if (r.overall.significant) smartFound++;
        await upsertWallet({
          address: r.addr,
          n: r.overall.n,
          meanEdge: r.overall.meanEdge,
          tStat: r.overall.tStat,
          pValue: r.overall.pValue,
          significant: r.overall.significant,
          winRate: r.overall.winRate,
          totalPnl: r.overall.totalPnl,
          roi: r.overall.roi,
          valueUsd: r.value,
          byCat: r.byCat,
          minHorizon,
        });
      }
      await markScored(batch);
    }

    return { discovered, scored: batch.length, smartFound, progress: await progress() };
  } finally {
    clearTimeout(timer);
  }
}
