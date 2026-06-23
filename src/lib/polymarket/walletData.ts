// Слой доступа к данным кошельков Polymarket:
//  - gamma: топ-рынки (для дискавери) и метаданные по conditionId (категория/горизонт/исход);
//  - data-api: holders рынка, позиции кошелька, стоимость портфеля.
// Из позиций + метаданных собираем разрешённые пари (ResolvedBet) для расчёта edge.

import { categoriesOf, type CatKey } from './classify';
import type { ResolvedBet } from './walletStats';

const GAMMA = 'https://gamma-api.polymarket.com/markets';
const DATA = 'https://data-api.polymarket.com';

function num(x: any, d = 0): number {
  const v = typeof x === 'string' ? parseFloat(x) : x;
  return Number.isFinite(v) ? v : d;
}

async function getJson(url: string, signal?: AbortSignal): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 500 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      if (attempt === 2) return null;
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
  return null;
}

export type MarketMeta = {
  conditionId: string;
  question: string;
  category: CatKey | null;
  horizonDays: number;       // длительность рынка
  closed: boolean;
  winningIndex: number | null; // индекс победившего исхода (если closed)
};

export type TopMarket = { conditionId: string; question: string };

// Топ активных + недавно закрытых рынков по объёму (для дискавери кошельков).
export async function topMarkets(pages = 4, includeClosed = true, signal?: AbortSignal): Promise<TopMarket[]> {
  const out: TopMarket[] = [];
  const states = includeClosed ? ['false', 'true'] : ['false'];
  for (const closed of states) {
    for (let p = 0; p < pages; p++) {
      const url = `${GAMMA}?closed=${closed}&order=volumeNum&ascending=false&limit=100&offset=${p * 100}`;
      const batch = await getJson(url, signal);
      if (!Array.isArray(batch) || !batch.length) break;
      for (const m of batch) if (m.conditionId) out.push({ conditionId: m.conditionId, question: m.question || '' });
      if (batch.length < 100) break;
    }
  }
  return out;
}

function metaFromRaw(m: any): MarketMeta {
  const start = m.startDate ? new Date(m.startDate).getTime() : NaN;
  const end = m.endDate ? new Date(m.endDate).getTime() : NaN;
  const horizonDays = Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 86400000 : Infinity;
  let winningIndex: number | null = null;
  if (m.closed) {
    try {
      const prices = (typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices) as any[];
      if (Array.isArray(prices) && prices.length) {
        let bi = 0, bv = -1;
        prices.forEach((p, i) => { const v = num(p); if (v > bv) { bv = v; bi = i; } });
        winningIndex = bi;
      }
    } catch { /* нет цен — исход неизвестен */ }
  }
  return {
    conditionId: m.conditionId,
    question: m.question || '',
    category: categoriesOf(m.question || '').primary,
    horizonDays,
    closed: !!m.closed,
    winningIndex,
  };
}

// Метаданные рынков по списку conditionId (батчами, repeated-параметр).
export async function marketsByConditionIds(ids: string[], signal?: AbortSignal): Promise<Map<string, MarketMeta>> {
  const map = new Map<string, MarketMeta>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  // Важно: gamma по condition_ids НЕ возвращает закрытые рынки без closed=true,
  // а для edge нужны именно разрешённые → запрашиваем closed=true.
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40);
    const qs = chunk.map((c) => `condition_ids=${encodeURIComponent(c)}`).join('&');
    const data = await getJson(`${GAMMA}?${qs}&closed=true&limit=100`, signal);
    if (Array.isArray(data)) for (const m of data) if (m.conditionId) map.set(m.conditionId, metaFromRaw(m));
  }
  return map;
}

// Адреса участников рынка (топ-холдеры по обоим исходам).
export async function marketHolders(conditionId: string, limit = 50, signal?: AbortSignal): Promise<string[]> {
  const data = await getJson(`${DATA}/holders?market=${conditionId}&limit=${limit}`, signal);
  const out: string[] = [];
  if (Array.isArray(data)) {
    for (const tok of data) {
      for (const h of tok.holders ?? []) if (h.proxyWallet) out.push(String(h.proxyWallet).toLowerCase());
    }
  }
  return out;
}

export async function walletPositions(user: string, signal?: AbortSignal): Promise<any[]> {
  const data = await getJson(`${DATA}/positions?user=${user}&limit=500`, signal);
  return Array.isArray(data) ? data : [];
}

export async function walletValue(user: string, signal?: AbortSignal): Promise<number> {
  const data = await getJson(`${DATA}/value?user=${user}`, signal);
  return Array.isArray(data) && data[0] ? num(data[0].value) : 0;
}

// Собрать разрешённые пари кошелька (только закрытые рынки с известным исходом).
export async function resolvedBets(user: string, signal?: AbortSignal): Promise<ResolvedBet[]> {
  const positions = await walletPositions(user, signal);
  if (!positions.length) return [];
  const ids = positions.map((p) => p.conditionId).filter(Boolean);
  const meta = await marketsByConditionIds(ids, signal);

  const bets: ResolvedBet[] = [];
  for (const p of positions) {
    const m = meta.get(p.conditionId);
    if (!m || !m.closed || m.winningIndex == null) continue; // только разрешённые
    const entry = num(p.avgPrice);
    if (entry <= 0 || entry >= 1) continue; // некорректный вход
    const win: 0 | 1 = num(p.outcomeIndex) === m.winningIndex ? 1 : 0;
    const cost = num(p.initialValue) || entry * num(p.size);
    const pnl = p.realizedPnl != null ? num(p.realizedPnl) : num(p.cashPnl);
    bets.push({
      conditionId: p.conditionId,
      category: m.category,
      horizonDays: m.horizonDays,
      win,
      entry,
      pnl,
      cost,
    });
  }
  return bets;
}
