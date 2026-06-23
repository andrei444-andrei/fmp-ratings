// Сбор и сборка данных Polymarket для страницы: gamma (список рынков) +
// clob (почасовая история вероятностей) + классификация + детект сдвигов + перевод.

import { categoriesOf, CATEGORIES, type CatKey } from './classify';
import { computeMovement, type HistPoint, type Movement } from './movement';
import { translateQuestions } from './translate';

const GAMMA = 'https://gamma-api.polymarket.com/markets';
const CLOB_HIST = 'https://clob.polymarket.com/prices-history';

export type Market = {
  id: string;
  question: string;
  ru: string;
  slug: string;
  cat: CatKey | null;
  prob: number;
  vol: number;
  liq: number;
  spread: number;
  daysLeft: number | null;
  // движение (если есть история)
  move: Movement | null;
};

export type Payload = {
  fetchedAt: string;
  totalScanned: number;
  hasHistory: boolean;
  translated: boolean;
  categories: { key: CatKey; label: string; desc: string; markets: Market[] }[];
  movers: Market[];
};

type Raw = Record<string, any>;

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

function firstToken(m: Raw): string | null {
  try {
    const t = m.clobTokenIds;
    const arr = typeof t === 'string' ? JSON.parse(t) : t;
    return Array.isArray(arr) && arr.length ? String(arr[0]) : null;
  } catch {
    return null;
  }
}

async function gammaPage(offset: number, signal: AbortSignal): Promise<Raw[]> {
  const url = `${GAMMA}?closed=false&order=volumeNum&ascending=false&limit=100&offset=${offset}`;
  const r = await fetch(url, { signal });
  if (r.status === 422) return [];
  if (!r.ok) throw new Error(`gamma ${r.status}`);
  return (await r.json()) as Raw[];
}

async function fetchHistory(token: string, signal: AbortSignal): Promise<HistPoint[]> {
  const url = `${CLOB_HIST}?market=${token}&interval=1m&fidelity=60`;
  const r = await fetch(url, { signal });
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  const hist = (data?.history ?? []) as any[];
  return hist.map((x) => ({ t: num(x.t), p: num(x.p) })).filter((x) => x.p > 0 && x.p < 1);
}

// Параллельная выборка истории с ограничением конкуренции.
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = undefined as any;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function buildPayload(opts?: { pages?: number; historyFor?: number }): Promise<Payload> {
  const pages = opts?.pages ?? 10;
  const historyFor = opts?.historyFor ?? 60;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    // 1) собираем активные рынки по объёму
    const raw: Raw[] = [];
    for (let p = 0; p < pages; p++) {
      const batch = await gammaPage(p * 100, ctrl.signal);
      if (!batch.length) break;
      raw.push(...batch);
      if (batch.length < 100) break;
    }

    // 2) классифицируем и оставляем релевантные
    const now = Date.now();
    const relevant: { mk: Market; token: string | null }[] = [];
    for (const m of raw) {
      const q: string = m.question || '';
      const { primary } = categoriesOf(q);
      if (!primary) continue;
      const end = m.endDate ? new Date(m.endDate).getTime() : null;
      const mk: Market = {
        id: String(m.id),
        question: q,
        ru: q,
        slug: m.slug || '',
        cat: primary,
        prob: prob(m),
        vol: num(m.volumeNum),
        liq: num(m.liquidityNum),
        spread: num(m.spread),
        daysLeft: end ? Math.round((end - now) / 86400000) : null,
        move: null,
      };
      relevant.push({ mk, token: firstToken(m) });
    }

    // 3) история вероятностей — выборка с охватом всех категорий:
    //    топ по ликвидности в каждой категории ∪ общий топ (не только ФРС/крипто).
    const tokened = relevant.filter((r) => r.token);
    const byLiq = [...tokened].sort((a, b) => b.mk.liq - a.mk.liq);
    const chosen = new Map<string, { mk: Market; token: string | null }>();
    for (const c of CATEGORIES) {
      byLiq.filter((r) => r.mk.cat === c.key).slice(0, 8).forEach((r) => chosen.set(r.mk.id, r));
    }
    for (const r of byLiq) {
      if (chosen.size >= historyFor) break;
      chosen.set(r.mk.id, r);
    }
    const withToken = Array.from(chosen.values());
    const hist = await mapLimit(withToken, 12, (r) => fetchHistory(r.token as string, ctrl.signal));
    withToken.forEach((r, idx) => {
      r.mk.move = computeMovement(hist[idx] || []);
    });
    const hasHistory = withToken.some((r) => r.mk.move);

    // 4) категории — топ по ликвидности в каждой
    const categories = CATEGORIES.map((c) => ({
      ...c,
      markets: relevant
        .filter((r) => r.mk.cat === c.key)
        .sort((a, b) => b.mk.liq - a.mk.liq)
        .slice(0, 12)
        .map((r) => r.mk),
    })).filter((c) => c.markets.length);

    // 5) «сдвиги» — рынки с историей, отсортированы по силе слома закономерности
    const movers = withToken
      .map((r) => r.mk)
      .filter((m) => m.move && (Math.abs(m.move.d7d) >= 0.03 || m.move.reversal || m.move.volSpike))
      .sort((a, b) => (b.move!.breakScore + Math.abs(b.move!.d24h)) - (a.move!.breakScore + Math.abs(a.move!.d24h)))
      .slice(0, 30);

    // 6) перевод всех показываемых вопросов одним проходом (с кэшем)
    const shown = new Set<string>();
    for (const c of categories) for (const m of c.markets) shown.add(m.question);
    for (const m of movers) shown.add(m.question);
    const ruMap = await translateQuestions(Array.from(shown));
    const translated = ruMap.size > 0;
    const apply = (m: Market) => {
      m.ru = ruMap.get(m.question) || m.question;
    };
    for (const c of categories) c.markets.forEach(apply);
    movers.forEach(apply);

    return {
      fetchedAt: new Date().toISOString(),
      totalScanned: raw.length,
      hasHistory,
      translated,
      categories,
      movers,
    };
  } finally {
    clearTimeout(timer);
  }
}
