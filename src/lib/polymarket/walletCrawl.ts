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
  discover?: boolean;       // обновить пул кандидатов
  discoverMarkets?: number; // сколько топ-рынков взять для дискавери
  holdersPer?: number;      // холдеров на рынок
  scoreWallets?: number;    // верхняя граница кошельков за вызов
  minHorizonDays?: number;
  minN?: number;
  budgetMs?: number;        // бюджет на скоринг (цикл пачками)
};

async function scoreOne(addr: string, minHorizon: number, minN: number, signal: AbortSignal) {
  const allBets = await resolvedBets(addr, signal);
  const bets: ResolvedBet[] = allBets.filter((b) => b.horizonDays >= minHorizon);
  const overall = edgeStats(bets, minN);
  const byCatStats = statsByCategory(bets, minN);
  const value = await walletValue(addr, signal);
  const byCat: WalletRow['byCat'] = {};
  for (const [k, s] of Object.entries(byCatStats)) {
    byCat[k] = { n: s.n, meanEdge: s.meanEdge, tStat: s.tStat, significant: s.significant, winRate: s.winRate, totalPnl: s.totalPnl };
  }
  return { addr, overall, byCat, value };
}

export async function crawlBatch(opts: CrawlOpts = {}): Promise<{
  discovered: number;
  scored: number;
  smartFound: number;
  progress: { candidates: number; scored: number; smart: number };
}> {
  const minHorizon = opts.minHorizonDays ?? 7;
  const minN = opts.minN ?? 20;
  const maxScore = opts.scoreWallets ?? 60;
  const budgetMs = opts.budgetMs ?? 45000;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  let discovered = 0;

  try {
    // 1) дискавери кандидатов (по запросу)
    if (opts.discover) {
      const pages = Math.max(1, Math.ceil((opts.discoverMarkets ?? 40) / 100));
      const markets = (await topMarkets(pages, true, ctrl.signal)).slice(0, opts.discoverMarkets ?? 40);
      const holderLists = await mapLimit(markets, 8, (m) => marketHolders(m.conditionId, opts.holdersPer ?? 60, ctrl.signal));
      const all = holderLists.flat().filter(Boolean);
      await addCandidates(all);
      discovered = new Set(all).size;
    }

    // 2) скоринг пачками, пока есть бюджет времени и кандидаты (один клик = много кошельков)
    let scored = 0;
    let smartFound = 0;
    while (scored < maxScore && Date.now() - started < budgetMs) {
      const want = Math.min(15, maxScore - scored);
      const batch = await nextUnscored(want);
      if (!batch.length) break;
      const results = await mapLimit(batch, 6, (a) => scoreOne(a, minHorizon, minN, ctrl.signal));
      for (const r of results) {
        if (!r) continue;
        if (r.overall.n === 0) continue; // нет разрешённых пари — не засоряем базу
        if (r.overall.significant) smartFound++;
        await upsertWallet({
          address: r.addr, n: r.overall.n, meanEdge: r.overall.meanEdge, tStat: r.overall.tStat,
          pValue: r.overall.pValue, significant: r.overall.significant, winRate: r.overall.winRate,
          totalPnl: r.overall.totalPnl, roi: r.overall.roi, valueUsd: r.value, byCat: r.byCat, minHorizon,
        });
      }
      await markScored(batch);
      scored += batch.length;
    }

    return { discovered, scored, smartFound, progress: await progress() };
  } finally {
    clearTimeout(timer);
  }
}
