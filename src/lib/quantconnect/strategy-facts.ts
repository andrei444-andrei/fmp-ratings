// «Глубокие» факты по стратегии для AI-чата: статистика бектеста (Sharpe/Sortino/
// трейды/win-rate), торгуемые инструменты из кода и сделки (ордера) по годам/инструментам.
// Кэшируется по backtestId.

import { qcReadBacktest, qcReadProjectFiles, qcReadBacktestOrders, type QcFile } from './client';
import { qcCacheGet, qcCacheSet } from './cache';

export type TradesYear = { total: number; symbols: Record<string, number> };
export type StrategyFacts = {
  statistics: Record<string, string>;
  symbols: string[];
  tradesByYear: Record<number, TradesYear>;
  tradesTotal: number;
  tradesCapped: boolean;
};

function extractSymbols(files: QcFile[]): string[] {
  const set = new Set<string>();
  const re = /(?:add_?equity|add_?crypto|add_?forex|add_?future|add_?option|add_?cfd|add_?index|add_?data|set_?benchmark|symbol\.create)\s*\(\s*["']([A-Za-z0-9.\-]{1,12})["']/gi;
  for (const f of files) {
    if (!/\.(py|cs)$/i.test(f.name)) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content))) set.add(m[1].toUpperCase());
  }
  return [...set].slice(0, 40);
}

export async function getStrategyFacts(projectId: string, backtestId: string): Promise<StrategyFacts> {
  const key = `facts|v2|${projectId}|${backtestId}`;
  const cached = await qcCacheGet<StrategyFacts>(key);
  if (cached && cached.tradesByYear) return cached;

  let statistics: Record<string, string> = {};
  try { statistics = (await qcReadBacktest(projectId, backtestId)).statistics; } catch { /* нет доступа */ }
  let symbols: string[] = [];
  try { symbols = extractSymbols(await qcReadProjectFiles(projectId)); } catch { /* нет файлов */ }

  const tradesByYear: Record<number, TradesYear> = {};
  let tradesTotal = 0, tradesCapped = false;
  try {
    const { orders, capped } = await qcReadBacktestOrders(projectId, backtestId);
    tradesCapped = capped;
    tradesTotal = orders.length;
    for (const o of orders) {
      const y = o.year ?? 0;
      if (!tradesByYear[y]) tradesByYear[y] = { total: 0, symbols: {} };
      tradesByYear[y].total++;
      tradesByYear[y].symbols[o.symbol] = (tradesByYear[y].symbols[o.symbol] || 0) + 1;
    }
  } catch { /* нет ордеров */ }

  const facts: StrategyFacts = { statistics, symbols, tradesByYear, tradesTotal, tradesCapped };
  if (Object.keys(statistics).length || symbols.length || tradesTotal) await qcCacheSet(key, facts);
  return facts;
}
