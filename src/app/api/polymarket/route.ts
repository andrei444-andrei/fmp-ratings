import { NextResponse } from 'next/server';

// Живые данные Polymarket для страницы /polymarket.
// Тянем топ активных рынков по объёму с gamma API, классифицируем релевантные
// для фондового рынка и считаем подразумеваемые вероятности.
// Кэшируем на стороне Next, чтобы не дёргать gamma на каждый запрос.

export const revalidate = 600; // 10 минут

const GAMMA = 'https://gamma-api.polymarket.com/markets';

type Raw = Record<string, any>;

type Market = {
  id: string;
  question: string;
  slug: string;
  prob: number; // подразумеваемая вероятность YES (0..1)
  vol: number;
  liq: number;
  spread: number;
  daysLeft: number | null;
  oneDay: number; // изменение цены за день
  oneWeek: number;
  cats: string[];
};

function num(x: any, d = 0): number {
  const v = typeof x === 'string' ? parseFloat(x) : x;
  return Number.isFinite(v) ? v : d;
}

function prob(m: Raw): number {
  try {
    const p = m.outcomePrices;
    const arr = typeof p === 'string' ? JSON.parse(p) : p;
    if (Array.isArray(arr) && arr.length) return num(arr[0]);
  } catch {
    /* fallthrough */
  }
  return num(m.lastTradePrice);
}

// --- классификация (по тексту вопроса, чтобы меньше шума) ---
const RX = {
  index: [/s&p\s*500/i, /\bspx\b/i, /\bspy\b/i, /nasdaq/i, /dow jones/i, /\bdjia\b/i, /stock market/i],
  macro: [/\bfed\b/i, /\bfomc\b/i, /interest rate/i, /rate (cut|hike|decision)/i, /\brecession\b/i, /\binflation\b/i, /\bcpi\b/i, /\bgdp\b/i, /unemployment/i, /powell/i, /\bbps\b/i, /basis points/i],
  megacap: [/largest company in the world/i, /second-largest company/i],
  crypto: [/\bbitcoin\b/i, /\bbtc\b/i, /\bethereum\b/i, /\beth\b/i, /\bcrypto\b/i, /solana/i],
};

function classify(q: string): string[] {
  const cats: string[] = [];
  if (RX.index.some((r) => r.test(q))) cats.push('index');
  if (RX.macro.some((r) => r.test(q))) cats.push('macro');
  if (RX.megacap.some((r) => r.test(q))) cats.push('megacap');
  if (RX.crypto.some((r) => r.test(q))) cats.push('crypto');
  return cats;
}

async function fetchPage(offset: number, signal: AbortSignal): Promise<Raw[]> {
  const url = `${GAMMA}?closed=false&order=volumeNum&ascending=false&limit=100&offset=${offset}`;
  const r = await fetch(url, { signal, next: { revalidate } });
  if (r.status === 422) return [];
  if (!r.ok) throw new Error(`gamma ${r.status}`);
  return (await r.json()) as Raw[];
}

export async function GET() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const raw: Raw[] = [];
    for (let p = 0; p < 8; p++) {
      const batch = await fetchPage(p * 100, ctrl.signal);
      if (!batch.length) break;
      raw.push(...batch);
      if (batch.length < 100) break;
    }

    const now = Date.now();
    const groups: Record<string, Market[]> = { macro: [], megacap: [], index: [], crypto: [] };

    for (const m of raw) {
      const q: string = m.question || '';
      const cats = classify(q);
      if (!cats.length) continue;
      const end = m.endDate ? new Date(m.endDate).getTime() : null;
      const mk: Market = {
        id: String(m.id),
        question: q,
        slug: m.slug || '',
        prob: prob(m),
        vol: num(m.volumeNum),
        liq: num(m.liquidityNum),
        spread: num(m.spread),
        daysLeft: end ? Math.round((end - now) / 86400000) : null,
        oneDay: num(m.oneDayPriceChange),
        oneWeek: num(m.oneWeekPriceChange),
        cats,
      };
      for (const c of cats) groups[c]?.push(mk);
    }

    // megacap: только "largest" (не second), сортировка по вероятности
    groups.megacap = groups.megacap
      .filter((m) => /largest company in the world/i.test(m.question) && !/second/i.test(m.question))
      .sort((a, b) => b.prob - a.prob);
    // macro: по объёму
    groups.macro.sort((a, b) => b.vol - a.vol);
    groups.macro = groups.macro.slice(0, 12);
    // index: по ликвидности
    groups.index.sort((a, b) => b.liq - a.liq);
    groups.index = groups.index.slice(0, 12);
    // crypto: по объёму
    groups.crypto.sort((a, b) => b.vol - a.vol);
    groups.crypto = groups.crypto.slice(0, 8);

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      totalScanned: raw.length,
      groups,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
