// Резюмируемый батч-краул «умных денег»:
//  1) дискавери кандидатов — холдеры топ-рынков по объёму (все категории);
//  2) скоринг следующей пачки кандидатов — edge-статистика по разрешённым пари
//     (горизонт ≥ minHorizonDays), разбивка по категориям, стоимость портфеля.
// Каждый вызов ограничен по объёму и дописывает прогресс в Turso.

import { topMarkets, marketHolders, resolvedBets, walletValue } from './walletData';
import { edgeStats, statsByCategory } from './walletStats';
import { addCandidates, nextUnscored, markScored, storeWalletBets, upsertWalletMeta, progress, type StoredBet } from './walletStore';

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

async function scoreOne(addr: string, signal: AbortSignal) {
  const allBets = await resolvedBets(addr, signal); // все разрешённые пари (любой горизонт)
  const value = await walletValue(addr, signal);
  return { addr, allBets, value };
}

export async function crawlBatch(opts: CrawlOpts = {}): Promise<{
  discovered: number;
  scored: number;
  smartFound: number;
  progress: { candidates: number; scored: number; smart: number };
}> {
  const minHorizon = opts.minHorizonDays ?? 30;
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
      const results = await mapLimit(batch, 6, (a) => scoreOne(a, ctrl.signal));
      for (const r of results) {
        if (!r) continue;
        if (!r.allBets.length) continue; // нет разрешённых пари вообще — пропускаем
        // храним сами события (для пересчёта под любой горизонт и AI-summary)
        const stored: StoredBet[] = r.allBets.map((b) => ({
          conditionId: b.conditionId, question: b.question ?? '', category: b.category,
          horizonDays: b.horizonDays, entry: b.entry, win: b.win, pnl: b.pnl, cost: b.cost, endDate: b.endDate ?? null,
        }));
        await storeWalletBets(r.addr, stored);
        // агрегат на дефолтном горизонте — в мету (значение + быстрый кэш)
        const bets = r.allBets.filter((b) => b.horizonDays >= minHorizon);
        const o = edgeStats(bets, minN);
        const byCatStats = statsByCategory(bets, minN);
        const byCat: Record<string, any> = {};
        for (const [k, s] of Object.entries(byCatStats)) {
          byCat[k] = { n: s.n, meanEdge: s.meanEdge, tStat: s.tStat, significant: s.significant, winRate: s.winRate, totalPnl: s.totalPnl };
        }
        if (o.significant) smartFound++;
        await upsertWalletMeta(r.addr, r.value, {
          n: o.n, meanEdge: o.meanEdge, tStat: o.tStat, pValue: o.pValue, significant: o.significant,
          winRate: o.winRate, totalPnl: o.totalPnl, roi: o.roi, byCat, minHorizon,
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
