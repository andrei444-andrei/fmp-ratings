// Оценка состава активов стратегии по годам. Позиции реконструируются из ордеров
// (cumulative signed qty), оцениваются по рыночной цене (FMP) на конец каждого месяца,
// затем доли усредняются по году → «в каких активах и в каком % сидели».
//
// Оговорки: не учитываются плечо/маржа, кэш-остаток, реинвест дивидендов; не-акции
// (фьючерсы/крипто/форекс/опционы), которых нет в FMP, оцениваются по последней цене
// сделки (приблизительно). Шорты учитываются по модулю экспозиции.

import { getStrategyTrades } from './trades';
import { getPrices } from '@/lib/research/prices';
import type { QcTrade } from './types';

export type YearAllocation = {
  year: number;
  weights: Record<string, number>; // символ -> средняя доля (0..1) по концам месяцев года
  cash: number;                    // средняя доля «вне рынка» (0..1)
  months: number;                  // сколько концов месяцев учтено
};
// Вклад тикера в доходность и сравнение с SPY (помесячная атрибуция, накопл. арифм.):
// contrib = Σ w·r_тикера; spyEquiv = Σ w·r_SPY за те же периоды; excess = contrib − spyEquiv.
export type TickerAttribution = {
  symbol: string;
  contrib: number;   // вклад тикера в доходность (доля, напр. 0.35 = +35 п.п. накопл.)
  spyEquiv: number;  // что дал бы SPY на этой же экспозиции
  excess: number;    // насколько тикер обыграл SPY (contrib − spyEquiv)
};
// Вклад/excess по тикерам в разрезе конкретного года.
export type YearAttribution = {
  year: number;
  contrib: Record<string, number>; // тикер → вклад в доходность за год
  excess: Record<string, number>;  // тикер → насколько обыграл SPY за год
};
export type AllocationResult = {
  id: number;
  name: string;
  years: YearAllocation[];
  symbols: string[];   // символы по убыванию средней значимости (для колонок таблицы)
  attribution: TickerAttribution[]; // по убыванию excess (накопл.)
  attributionByYear: YearAttribution[]; // вклад/excess по годам
  approx: boolean;     // были ли инструменты без рыночной цены (оценка по сделкам)
  capped: boolean;     // ордера обрезаны лимитом → состав может быть неполным
  error: string | null;
};

const dts = (d: string) => Date.parse(d + 'T00:00:00Z');

// Цены символа: ищем последний close с датой ≤ нужной (carry-forward).
class PriceLookup {
  private dates: number[] = [];
  private closes: number[] = [];
  constructor(rows: { date: string; close: number }[]) {
    const sorted = [...rows].filter(r => isFinite(r.close) && r.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const r of sorted) { this.dates.push(dts(r.date)); this.closes.push(r.close); }
  }
  get size() { return this.dates.length; }
  at(ms: number): number | null {
    if (!this.dates.length || ms < this.dates[0]) return null;
    let lo = 0, hi = this.dates.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.dates[mid] <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? this.closes[ans] : null;
  }
}

// Последняя цена сделки по символу с временем ≤ ms (фолбэк, если нет рыночной цены).
function tradePriceLookup(trades: QcTrade[]): Map<string, { ms: number; price: number }[]> {
  const m = new Map<string, { ms: number; price: number }[]>();
  for (const t of trades) {
    if (!(t.price > 0)) continue;
    const ms = Date.parse(t.time);
    if (!isFinite(ms)) continue;
    (m.get(t.symbol) ?? m.set(t.symbol, []).get(t.symbol)!).push({ ms, price: t.price });
  }
  for (const arr of m.values()) arr.sort((a, b) => a.ms - b.ms);
  return m;
}
function lastTradePrice(list: { ms: number; price: number }[] | undefined, ms: number): number | null {
  if (!list || !list.length || ms < list[0].ms) return null;
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].ms <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 ? list[ans].price : null;
}

// Концы месяцев (последний день) от первого до последнего месяца торговли.
function monthEnds(firstMs: number, lastMs: number): { ms: number; year: number }[] {
  const out: { ms: number; year: number }[] = [];
  const start = new Date(firstMs);
  let y = start.getUTCFullYear(), mo = start.getUTCMonth();
  const end = new Date(lastMs);
  const endY = end.getUTCFullYear(), endMo = end.getUTCMonth();
  while (y < endY || (y === endY && mo <= endMo)) {
    // последний день месяца = день 0 следующего месяца
    const ms = Date.UTC(y, mo + 1, 0);
    out.push({ ms, year: y });
    mo++; if (mo > 11) { mo = 0; y++; }
    if (out.length > 1200) break; // защита
  }
  return out;
}

export async function getStrategyAllocation(id: number, force = false, endIso?: string): Promise<AllocationResult> {
  const tr = await getStrategyTrades(id, force);
  const empty = (error: string | null): AllocationResult => ({ id, name: tr.name, years: [], symbols: [], attribution: [], attributionByYear: [], approx: false, capped: tr.capped, error });
  if (tr.error) return empty(tr.error);
  const trades = (tr.trades || []).filter(t => t.time && (t.direction === 'buy' || t.direction === 'sell') && t.quantity > 0);
  if (!trades.length) return empty(null);

  // события позиций по символам (signed qty)
  const events = trades
    .map(t => ({ ms: Date.parse(t.time), symbol: t.symbol, dq: (t.direction === 'buy' ? 1 : -1) * t.quantity }))
    .filter(e => isFinite(e.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!events.length) return empty(null);

  // Конец таймлайна — до конца бэктеста (если передан endIso): позиции после последней
  // сделки держатся, и их нужно довести mark-to-market до конца ряда, а не до последнего ордера.
  const firstMs = events[0].ms;
  const lastOrderMs = events[events.length - 1].ms;
  const endMs = endIso ? Date.parse(endIso + 'T00:00:00Z') : NaN;
  const lastMs = (isFinite(endMs) && endMs > lastOrderMs) ? endMs : lastOrderMs;
  const symbolsAll = [...new Set(events.map(e => e.symbol))];

  // рыночные цены по каждому символу (FMP, кэш в Turso). Параллельно, лимит на всякий.
  const from = `${new Date(firstMs).getUTCFullYear()}-01-01`;
  const to = `${new Date(lastMs).getUTCFullYear()}-12-31`;
  const priceById = new Map<string, PriceLookup>();
  await Promise.all(symbolsAll.slice(0, 60).map(async sym => {
    try {
      const rows = await getPrices(sym, from, to);
      priceById.set(sym, new PriceLookup(rows.map(r => ({ date: r.date, close: r.close }))));
    } catch { priceById.set(sym, new PriceLookup([])); }
  }));
  const tradePx = tradePriceLookup(trades);

  // SPY-цены для сравнения вклада тикеров (уже могут быть в priceById)
  let spyLk = priceById.get('SPY') ?? null;
  if (!spyLk) {
    try { const r = await getPrices('SPY', from, to); spyLk = new PriceLookup(r.map(x => ({ date: x.date, close: x.close }))); }
    catch { spyLk = new PriceLookup([]); }
  }
  // цена символа на дату: рыночная (FMP) → фолбэк на последнюю цену сделки
  const priceAt = (sym: string, ms: number): number | null => {
    const p = priceById.get(sym)?.at(ms) ?? null;
    return p != null ? p : lastTradePrice(tradePx.get(sym), ms);
  };

  // по концам месяцев: позиция → стоимость → доли; усредняем по году. Параллельно
  // копим снимки (signed value + gross) для помесячной атрибуции вклада тикеров.
  const ends = monthEnds(firstMs, lastMs);
  const acc = new Map<number, { weights: Map<string, number>; cash: number; months: number }>();
  const snapshots: { ms: number; signed: Map<string, number>; gross: number }[] = [];
  let approx = false;

  for (const me of ends) {
    // позиция каждого символа на конец месяца
    const pos = new Map<string, number>();
    // events отсортированы — пройдёмся (символов немного, месяцев ≤ ~300; ок)
    for (const e of events) {
      if (e.ms > me.ms) break;
      pos.set(e.symbol, (pos.get(e.symbol) || 0) + e.dq);
    }
    // стоимость позиций (|value| для долей, signed для атрибуции)
    const value = new Map<string, number>();
    const signed = new Map<string, number>();
    let gross = 0;
    for (const [sym, q] of pos) {
      if (Math.abs(q) < 1e-9) continue;
      let px = priceById.get(sym)?.at(me.ms) ?? null;
      if (px == null) { px = lastTradePrice(tradePx.get(sym), me.ms); if (px != null) approx = true; }
      if (px == null || !(px > 0)) continue;
      const sv = q * px;
      value.set(sym, Math.abs(sv)); signed.set(sym, sv); gross += Math.abs(sv);
    }
    const a = acc.get(me.year) ?? acc.set(me.year, { weights: new Map(), cash: 0, months: 0 }).get(me.year)!;
    a.months++;
    snapshots.push({ ms: me.ms, signed, gross });
    if (gross <= 0) { a.cash += 1; continue; }
    for (const [sym, v] of value) a.weights.set(sym, (a.weights.get(sym) || 0) + v / gross);
  }

  // усреднение + сортировка символов по суммарной значимости
  const importance = new Map<string, number>();
  const years: YearAllocation[] = [...acc.entries()].sort((x, y) => x[0] - y[0]).map(([year, a]) => {
    const weights: Record<string, number> = {};
    for (const [sym, w] of a.weights) {
      const avg = w / a.months;
      weights[sym] = avg;
      importance.set(sym, (importance.get(sym) || 0) + avg);
    }
    return { year, weights, cash: a.cash / a.months, months: a.months };
  });
  const symbols = [...importance.entries()].sort((x, y) => y[1] - x[1]).map(([s]) => s);

  // атрибуция: помесячно w_(t-1)·(r_тикера − r_SPY), накопл. арифм. signed-веса (учитывают шорты).
  // Параллельно копим по годам (доход реализуется в году cur) — для разбивки «что дало в каждый год».
  const contribM = new Map<string, number>(), spyM = new Map<string, number>();
  const contribY = new Map<number, Map<string, number>>(), spyY = new Map<number, Map<string, number>>();
  const bump = (m: Map<number, Map<string, number>>, yr: number, sym: string, v: number) => {
    const row = m.get(yr) ?? m.set(yr, new Map()).get(yr)!;
    row.set(sym, (row.get(sym) || 0) + v);
  };
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1], cur = snapshots[i];
    if (prev.gross <= 0) continue;
    const yr = new Date(cur.ms).getUTCFullYear();
    const sp0 = spyLk?.at(prev.ms) ?? null, sp1 = spyLk?.at(cur.ms) ?? null;
    const rSpy = (sp0 != null && sp1 != null && sp0 > 0) ? sp1 / sp0 - 1 : null;
    for (const [sym, sv] of prev.signed) {
      const p0 = priceAt(sym, prev.ms), p1 = priceAt(sym, cur.ms);
      if (p0 == null || p1 == null || !(p0 > 0)) continue;
      const w = sv / prev.gross;
      const cM = w * (p1 / p0 - 1);
      contribM.set(sym, (contribM.get(sym) || 0) + cM);
      bump(contribY, yr, sym, cM);
      if (rSpy != null) { spyM.set(sym, (spyM.get(sym) || 0) + w * rSpy); bump(spyY, yr, sym, w * rSpy); }
    }
  }
  const attribution: TickerAttribution[] = [...contribM.keys()].map(sym => {
    const c = contribM.get(sym) || 0, s = spyM.get(sym) || 0;
    return { symbol: sym, contrib: c, spyEquiv: s, excess: c - s };
  }).sort((x, y) => y.excess - x.excess);

  // разбивка вклада/excess по годам (год → тикер → значение)
  const attributionByYear: YearAttribution[] = [...contribY.keys()].sort((a, b) => a - b).map(year => {
    const cRow = contribY.get(year)!, sRow = spyY.get(year) ?? new Map<string, number>();
    const contrib: Record<string, number> = {}, excess: Record<string, number> = {};
    for (const [sym, c] of cRow) { contrib[sym] = c; excess[sym] = c - (sRow.get(sym) || 0); }
    return { year, contrib, excess };
  });

  return { id, name: tr.name, years, symbols, attribution, attributionByYear, approx, capped: tr.capped, error: null };
}
