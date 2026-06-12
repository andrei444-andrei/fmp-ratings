// «Глубокие» факты по стратегии для AI-чата: статистика бектеста (Sharpe/Sortino/
// трейды/win-rate) и торгуемые инструменты из кода. Кэшируется по backtestId.

import { qcReadBacktest, qcReadProjectFiles, type QcFile } from './client';
import { qcCacheGet, qcCacheSet } from './cache';

export type StrategyFacts = { statistics: Record<string, string>; symbols: string[] };

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
  const key = `facts|v1|${projectId}|${backtestId}`;
  const cached = await qcCacheGet<StrategyFacts>(key);
  if (cached) return cached;

  let statistics: Record<string, string> = {};
  try { statistics = (await qcReadBacktest(projectId, backtestId)).statistics; } catch { /* нет доступа — пропускаем */ }
  let symbols: string[] = [];
  try { symbols = extractSymbols(await qcReadProjectFiles(projectId)); } catch { /* нет файлов — пропускаем */ }

  const facts: StrategyFacts = { statistics, symbols };
  if (Object.keys(statistics).length || symbols.length) await qcCacheSet(key, facts);
  return facts;
}
