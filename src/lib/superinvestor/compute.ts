// Чистый компьют-движок раздела superinvestor (без I/O — работает и на сервере,
// и на клиенте). Вход: нормализованные холдинги по кварталам + матрица цен.
// Выход: equity-кривые copy-стратегии, закрытые/открытые сделки, KPI, heatmap, бэктест.

import type {
  Holding, QuarterHoldings, PriceMatrix, EquityCurve, ClosedTrade, OpenPosition,
  HoldingsHeatmap, Kpis, BacktestConfig, BacktestResult,
} from './types';

// ===== Низкоуровневые помощники =====

// Forward-fill: заполняем null последним известным значением (ведущие null остаются).
function forwardFill(arr: (number | null)[]): (number | null)[] {
  const out = arr.slice();
  let last: number | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) last = out[i];
    else out[i] = last;
  }
  return out;
}

// Матрица цен с forward-fill по каждому символу — считаем один раз.
function filledMatrix(pm: PriceMatrix): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const sym of Object.keys(pm.series)) out[sym] = forwardFill(pm.series[sym]);
  return out;
}

// Индекс первого торгового дня >= date, затем +delayDays (торговых дней).
function entryIndex(dates: string[], dateISO: string, delayDays: number): number | null {
  // dates отсортированы по возрастанию — бинарный поиск нижней границы.
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < dateISO) lo = mid + 1; else hi = mid;
  }
  let i = lo;
  if (i >= dates.length) return null;
  i += delayDays;
  if (i >= dates.length) return null;
  return i;
}

function cagr(totalReturn: number, years: number): number {
  if (years <= 0) return 0;
  const g = 1 + totalReturn;
  if (g <= 0) return -1;
  return Math.pow(g, 1 / years) - 1;
}

function yearsBetween(a: string, b: string): number {
  return Math.max(0, (+new Date(b) - +new Date(a)) / (365.25 * 86400000));
}

// Макс. просадка по кривой стоимости (возвращает отрицательное число, доля).
function maxDrawdown(values: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = v / peak - 1;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd;
}

// Годовой Sharpe из месячных доходностей кривой (rf = 0).
function sharpeFromCurve(dates: string[], values: number[]): number {
  if (dates.length < 3) return 0;
  // Берём значение на последний день каждого календарного месяца.
  const monthEndIdx: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const cur = dates[i].slice(0, 7);
    const next = i + 1 < dates.length ? dates[i + 1].slice(0, 7) : null;
    if (next !== cur) monthEndIdx.push(i);
  }
  if (monthEndIdx.length < 3) return 0;
  const rets: number[] = [];
  for (let k = 1; k < monthEndIdx.length; k++) {
    const a = values[monthEndIdx[k - 1]], b = values[monthEndIdx[k]];
    if (a > 0) rets.push(b / a - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(12);
}

// ===== Copy-стратегия: equity-кривая =====
//
// Логика: в каждую дату подачи 13F (filing + задержка) ребалансируем виртуальный
// портфель под раскрытые веса (с отсечкой по minWeight и ренормировкой), держим
// до следующего филинга, считаем дневную стоимость по числу акций.
export function copyEquityCurve(
  quarters: QuarterHoldings[],
  pm: PriceMatrix,
  cfg: BacktestConfig,
): EquityCurve {
  const { dates } = pm;
  const ff = filledMatrix(pm);
  const empty: EquityCurve = { dates: [], copy: [], spy: [], rebalanceDates: [] };
  if (!dates.length || !quarters.length || !ff['SPY']) return empty;

  // Точки ребаланса: индекс входа по каждому кварталу.
  const rebs: { idx: number; q: QuarterHoldings }[] = [];
  for (const q of [...quarters].sort((a, b) => a.filingDate.localeCompare(b.filingDate))) {
    const idx = entryIndex(dates, q.filingDate, cfg.delayDays);
    if (idx == null) continue;
    const prev = rebs[rebs.length - 1];
    if (prev && prev.idx === idx) prev.q = q; // тот же день — берём свежий филинг
    else rebs.push({ idx, q });
  }
  if (!rebs.length) return empty;

  const startIdx = rebs[0].idx;
  const outDates: string[] = [];
  const copy: number[] = [];
  const spy: number[] = [];

  // SPY-старт — первая ненулевая цена на/после startIdx.
  let spyStart: number | null = null;
  for (let i = startIdx; i < dates.length; i++) { if (ff['SPY'][i] != null) { spyStart = ff['SPY'][i]; break; } }
  if (spyStart == null) return empty;

  let shares: Record<string, number> = {};
  let rebPtr = 0;

  for (let i = startIdx; i < dates.length; i++) {
    // Ребаланс, если достигли индекса очередного филинга.
    while (rebPtr < rebs.length && rebs[rebPtr].idx === i) {
      const q = rebs[rebPtr].q;
      const equity = i === startIdx ? 1 : portfolioValue(shares, ff, i);
      // Кандидаты: вес >= minWeight и есть цена на день входа.
      const cands = q.holdings.filter(h => h.weight >= cfg.minWeight && ff[h.symbol]?.[i] != null);
      const wsum = cands.reduce((s, h) => s + h.weight, 0);
      if (wsum > 0 && equity > 0) {
        shares = {};
        for (const h of cands) {
          const w = h.weight / wsum;            // ренормировка под отобранные позиции
          const price = ff[h.symbol]![i]!;
          shares[h.symbol] = (equity * w) / price;
        }
      }
      // если кандидатов нет — оставляем прежний портфель (или кэш на старте)
      rebPtr++;
    }
    outDates.push(dates[i]);
    copy.push(i === startIdx && Object.keys(shares).length === 0 ? 1 : portfolioValue(shares, ff, i) || 1);
    spy.push(ff['SPY'][i]! / spyStart);
  }

  // Нормировка старта copy к 1 (на случай кэш-старта).
  const base = copy[0] || 1;
  for (let k = 0; k < copy.length; k++) copy[k] /= base;

  return {
    dates: outDates,
    copy,
    spy,
    rebalanceDates: rebs.map(r => dates[r.idx]),
  };
}

function portfolioValue(shares: Record<string, number>, ff: Record<string, (number | null)[]>, idx: number): number {
  let v = 0;
  for (const sym of Object.keys(shares)) {
    const p = ff[sym]?.[idx];
    if (p != null) v += shares[sym] * p;
  }
  return v;
}

// ===== Сделки: закрытые + открытые (модель средней цены) =====
export function deriveTrades(
  quarters: QuarterHoldings[],
  pm: PriceMatrix,
): { closed: ClosedTrade[]; open: OpenPosition[] } {
  const { dates } = pm;
  const ff = filledMatrix(pm);
  const qs = [...quarters].sort((a, b) => a.filingDate.localeCompare(b.filingDate));

  type Pos = { shares: number; avgCost: number; openDate: string; name?: string; peak: number; firstSeen: string; quarters: number };
  const pos: Record<string, Pos> = {};
  const closed: ClosedTrade[] = [];

  // Цена символа на дату филинга (с forward-fill); фолбэк — implied (value/shares).
  function priceAtFiling(sym: string, fd: string, fallback?: number): number | null {
    const idx = entryIndex(dates, fd, 0);
    if (idx != null) { const p = ff[sym]?.[idx]; if (p != null) return p; }
    return fallback ?? null;
  }
  function spyReturn(openDate: string, closeDate: string): number {
    const ia = entryIndex(dates, openDate, 0), ib = entryIndex(dates, closeDate, 0);
    if (ia == null || ib == null) return 0;
    const a = ff['SPY']?.[ia], b = ff['SPY']?.[ib];
    if (a == null || b == null || a === 0) return 0;
    return b / a - 1;
  }

  for (const q of qs) {
    const fd = q.filingDate;
    const cur: Record<string, Holding> = {};
    for (const h of q.holdings) cur[h.symbol] = h;
    const syms = new Set<string>([...Object.keys(pos), ...Object.keys(cur)]);

    for (const sym of syms) {
      const prevShares = pos[sym]?.shares ?? 0;
      const h = cur[sym];
      const curShares = h?.shares ?? 0;
      const implied = h && h.shares > 0 ? h.value / h.shares : undefined;
      const price = priceAtFiling(sym, fd, implied) ?? pos[sym]?.avgCost ?? implied ?? 0;

      if (curShares > prevShares) {
        const delta = curShares - prevShares;
        if (prevShares === 0) {
          pos[sym] = { shares: curShares, avgCost: price, openDate: fd, name: h?.name, peak: curShares, firstSeen: fd, quarters: 1 };
        } else {
          const p = pos[sym];
          p.avgCost = (p.avgCost * prevShares + price * delta) / curShares;
          p.shares = curShares;
          p.peak = Math.max(p.peak, curShares);
          p.quarters++;
          if (h?.name) p.name = h.name;
        }
      } else if (curShares < prevShares) {
        const p = pos[sym];
        if (curShares === 0) {
          // Полный выход — фиксируем закрытую сделку.
          const ret = p.avgCost > 0 ? price / p.avgCost - 1 : 0;
          const spy = spyReturn(p.openDate, fd);
          closed.push({
            symbol: sym, name: p.name,
            openDate: p.openDate, closeDate: fd,
            entryPrice: p.avgCost, exitPrice: price, shares: p.peak,
            returnPct: ret, spyReturnPct: spy, alphaPct: ret - spy,
            holdingDays: Math.round((+new Date(fd) - +new Date(p.openDate)) / 86400000),
            year: parseInt(fd.slice(0, 4), 10),
          });
          delete pos[sym];
        } else {
          p.shares = curShares;       // частичная продажа — avgCost не меняем
          p.quarters++;
        }
      } else if (h) {
        // вес/имя могут измениться без сделки
        if (pos[sym]) { pos[sym].quarters++; if (h.name) pos[sym].name = h.name; }
      }
    }
  }

  // Открытые позиции — остаток + нереализованный P&L по последней цене.
  const lastQ = qs[qs.length - 1];
  const lastBySym: Record<string, Holding> = {};
  if (lastQ) for (const h of lastQ.holdings) lastBySym[h.symbol] = h;
  const lastIdx = dates.length - 1;

  const open: OpenPosition[] = Object.keys(pos).map(sym => {
    const p = pos[sym];
    const h = lastBySym[sym];
    let lastPrice = ff[sym]?.[lastIdx] ?? null;
    if (lastPrice == null && h && h.shares > 0) lastPrice = h.value / h.shares;
    const lp = lastPrice ?? p.avgCost;
    return {
      symbol: sym, name: p.name ?? h?.name,
      shares: p.shares,
      weight: h?.weight ?? 0,
      value: h?.value ?? p.shares * lp,
      avgCost: p.avgCost,
      lastPrice: lp,
      unrealizedPct: p.avgCost > 0 ? lp / p.avgCost - 1 : 0,
      firstSeen: p.firstSeen,
      quartersHeld: p.quarters,
    };
  }).sort((a, b) => b.value - a.value);

  closed.sort((a, b) => b.closeDate.localeCompare(a.closeDate));
  return { closed, open };
}

// ===== KPI =====
export function computeKpis(
  curve: EquityCurve,
  closed: ClosedTrade[],
  openCount: number,
): Kpis {
  const n = curve.copy.length;
  const copyReturn = n ? curve.copy[n - 1] - 1 : 0;
  const spyReturn = n ? curve.spy[n - 1] - 1 : 0;
  const years = n ? yearsBetween(curve.dates[0], curve.dates[n - 1]) : 0;
  const alphaAnn = cagr(copyReturn, years) - cagr(spyReturn, years);
  const wins = closed.filter(t => t.returnPct > 0).length;
  const alphaWins = closed.filter(t => t.alphaPct > 0).length;
  return {
    alphaPct: (copyReturn - spyReturn) * 100,
    alphaAnnPct: alphaAnn * 100,
    copyReturnPct: copyReturn * 100,
    spyReturnPct: spyReturn * 100,
    winRatePct: closed.length ? (wins / closed.length) * 100 : 0,
    alphaWinRatePct: closed.length ? (alphaWins / closed.length) * 100 : 0,
    sharpe: sharpeFromCurve(curve.dates, curve.copy),
    maxDrawdownPct: maxDrawdown(curve.copy) * 100,
    closedTrades: closed.length,
    openPositions: openCount,
  };
}

// ===== Heatmap холдингов (символ × квартал, вес) =====
export function buildHoldingsHeatmap(quarters: QuarterHoldings[]): HoldingsHeatmap {
  const qs = [...quarters].sort((a, b) => a.period.localeCompare(b.period));
  const periods = qs.map(q => q.period);
  const idxOf: Record<string, number> = {};
  periods.forEach((p, i) => (idxOf[p] = i));

  const weights: Record<string, (number | null)[]> = {};
  const names: Record<string, string> = {};
  const maxW: Record<string, number> = {};
  const lastSeen: Record<string, number> = {};

  for (const q of qs) {
    for (const h of q.holdings) {
      if (!weights[h.symbol]) weights[h.symbol] = periods.map(() => null);
      weights[h.symbol][idxOf[q.period]] = h.weight;
      if (h.name) names[h.symbol] = h.name;
      maxW[h.symbol] = Math.max(maxW[h.symbol] ?? 0, h.weight);
      lastSeen[h.symbol] = Math.max(lastSeen[h.symbol] ?? -1, idxOf[q.period]);
    }
  }

  // Порядок строк: позиции из свежего квартала важнее (по lastSeen ↓), затем по макс. весу ↓.
  const symbols = Object.keys(weights).sort((a, b) =>
    (lastSeen[b] - lastSeen[a]) || (maxW[b] - maxW[a]));

  return { periods, symbols, names, weights };
}

// ===== Бэктест: набор конфигов входа =====
export function runBacktest(
  quarters: QuarterHoldings[],
  pm: PriceMatrix,
  configs: BacktestConfig[],
): BacktestResult[] {
  return configs.map(config => {
    const curve = copyEquityCurve(quarters, pm, config);
    const n = curve.copy.length;
    const finalCopy = n ? curve.copy[n - 1] - 1 : 0;
    const finalSpy = n ? curve.spy[n - 1] - 1 : 0;
    return {
      config,
      curve,
      finalCopyPct: finalCopy * 100,
      finalAlphaPct: (finalCopy - finalSpy) * 100,
      sharpe: sharpeFromCurve(curve.dates, curve.copy),
      maxDrawdownPct: maxDrawdown(curve.copy) * 100,
    };
  });
}

// ===== Цветовой градиент (тот же, что в /heatmap) =====
//
// Зелёный/красный с насыщенностью по |value/clamp|. Для весов (всегда >= 0)
// получаем чисто зелёную шкалу.
export function cellColor(r: number | null, clamp: number): string {
  if (r == null || !isFinite(r)) return 'transparent';
  const x = Math.max(-1, Math.min(1, r / clamp));
  const a = Math.min(1, Math.sqrt(Math.abs(x)) / 1.05);
  if (Math.abs(x) < 0.04) return 'rgba(255,255,255,.025)';
  if (x >= 0) return `rgba(52, 211, 153, ${(0.16 + a * 0.64).toFixed(3)})`;
  return `rgba(244, 98, 106, ${(0.16 + a * 0.62).toFixed(3)})`;
}

export function textColorOn(r: number | null, clamp: number): string {
  if (r == null) return 'var(--hm-tx3)';
  const x = Math.abs(r / clamp);
  if (x < 0.04) return 'var(--hm-tx3)';
  if (x > 0.8) return '#fff';
  return r > 0 ? '#9ff0d2' : '#fbb9bd';
}
