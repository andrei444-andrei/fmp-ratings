// Сделки одной стратегии (для просмотра по месяцу). Стратегия резолвится по id →
// projectId/backtestId, сделки тянутся из QC и кэшируются по backtestId (неизменен).

import { listAlgorithms } from './algorithms';
import { qcReadBacktestTrades } from './client';
import { qcCacheGet, qcCacheSet } from './cache';
import { resolveBacktestId } from './portfolio';
import type { QcTrade, TradesResponse } from './types';

export async function getStrategyTrades(id: number, force = false): Promise<TradesResponse> {
  const all = await listAlgorithms();
  const a = all.find(x => x.id === id);
  if (!a) return { id, name: '', trades: [], capped: false, total: 0, error: 'стратегия не найдена', resolvedBacktestId: null };

  let backtestId: string | null = null;
  try {
    backtestId = await resolveBacktestId(a.projectId, a.backtestId);
  } catch (e: any) {
    return { id, name: a.name, trades: [], capped: false, total: 0, error: e?.message || String(e), resolvedBacktestId: null };
  }
  if (!backtestId) return { id, name: a.name, trades: [], capped: false, total: 0, error: 'в проекте нет бектестов', resolvedBacktestId: null };

  // v2: раньше тянули только первые 2500 ордеров (кап) → старый кэш неполный, игнорируем.
  const key = `trades|v2|${a.projectId}|${backtestId}`;
  if (!force) {
    const cached = await qcCacheGet<{ trades: QcTrade[]; capped: boolean }>(key);
    if (cached && cached.trades) {
      return { id, name: a.name, trades: cached.trades, capped: cached.capped, total: cached.trades.length, error: null, resolvedBacktestId: backtestId };
    }
  }
  try {
    const { trades, capped } = await qcReadBacktestTrades(a.projectId, backtestId);
    if (trades.length) await qcCacheSet(key, { trades, capped });
    return { id, name: a.name, trades, capped, total: trades.length, error: null, resolvedBacktestId: backtestId };
  } catch (e: any) {
    return { id, name: a.name, trades: [], capped: false, total: 0, error: e?.message || String(e), resolvedBacktestId: backtestId };
  }
}
