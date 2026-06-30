// Движок раздела «Портфели»: объединение СЕТАПОВ (потоков сделок) в одну стратегию и расчёт метрик.
//
// Каждый сетап даёт РАЗРЕЖЕННЫЙ поток сделок [дата входа, доходность за горизонт]. Здесь мы
// раскладываем их на ПЛОТНЫЙ дневной календарь (торговые дни берём из ряда SPY), собираем дневную
// доходность портфеля по правилу сайзинга (равный вес среди живых позиций; опц. лимит топ-K),
// компаундим в кривую капитала и считаем загрузку / CAGR / просадку / Sharpe / превышение над SPY.
//
// Чистые функции: ряды SPY/BIL передаются СНАРУЖИ (роут грузит их через getPrices), модуль не ходит
// в сеть и легко тестируется.
//
// Методология (важно):
//  • Внутридневной путь сделки усреднён ГЕОМЕТРИЧЕСКИ: дневная ставка = (1+ret)^(1/H)−1 на каждый из
//    H дней удержания. Терминальная доходность сделки и ЗАГРУЗКА точные; эквити ВНУТРИ сделки сглажено
//    (точного дневного пути в потоке нет — только итог + конверты mfe/mae/mdd).
//  • Ранжирование для лимита топ-K идёт по ИСТОРИЧЕСКОМУ эджу сетапа (rankWeight), НЕ по будущей
//    доходности конкретной сделки — иначе был бы look-ahead.
//  • Оценка in-sample на всей истории (сетапы приходят из скринера — это техническая прогонка их
//    совместного поведения, а не прогноз).

export type EngineDeal = { date: string; ret: number }; // дата входа (YYYY-MM-DD) + доходность за горизонт, в %
export type EngineSetup = {
  id: string;
  name: string;
  horizon: number; // длина удержания в торговых днях (config.horizon)
  rankWeight: number; // ключ ранжирования для лимита топ-K (выше = приоритетнее)
  deals: EngineDeal[];
};
export type Parking = 'BIL' | 'SPY' | 'CASH';
export type EngineConfig = {
  weighting: 'equal';
  maxConcurrent: number | null; // лимит одновременных позиций (топ-K по rankWeight); null/0 — без лимита
  parking: Parking;
};
export type Bar = { date: string; close: number };
export type DayPoint = { d: string; v: number };

export type PortfolioMetrics = {
  nSetups: number;
  nDeals: number;
  days: number; // торговых дней в периоде стратегии
  inMarketDays: number;
  loading: number | null; // доля дней в рынке (загрузка по времени), 0..1
  start: string | null;
  end: string | null;
  years: number;
  total: number | null; // полная доходность портфеля (с учётом паркинга простоя)
  cagr: number | null; // годовая (сложный процент)
  maxDD: number | null; // макс. просадка кривой (≤0)
  vol: number | null; // годовая волатильность
  sharpe: number | null; // Sharpe (rf=0), по всем дням периода
  sharpeActive: number | null; // Sharpe только по дням в рынке (рабочий рукав)
  returnOnLoading: number | null; // CAGR ÷ загрузка
  // бенчмарк SPY (buy & hold на том же периоде)
  spyTotal: number | null;
  spyCagr: number | null;
  spyMaxDD: number | null;
  spySharpe: number | null;
  // относительно SPY (альфа = простое превышение, без беты)
  excessTotal: number | null; // total − spyTotal
  excessCagr: number | null; // cagr − spyCagr
  alphaOnLoading: number | null; // excessCagr ÷ загрузка
  sharpeVsSpy: number | null; // sharpe ÷ spySharpe
};

export type PortfolioResult = {
  metrics: PortfolioMetrics;
  equity: DayPoint[]; // кривая капитала портфеля (старт = 1)
  benchEquity: DayPoint[]; // SPY на тех же днях (старт = 1)
  concurrency: number[]; // число отобранных позиций по дням (для графика загрузки)
};

const TRADING_DAYS = 252;
const dts = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

function dedupSortBars(bars: Bar[]): Bar[] {
  const m = new Map<string, number>();
  for (const b of bars) {
    if (!b || !b.date || !Number.isFinite(b.close)) continue;
    m.set(b.date, b.close); // последний по дню
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, close]) => ({ date, close }));
}

function maxDrawdown(eq: number[]): number | null {
  const v = eq.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return null;
  let peak = v[0];
  let mdd = 0;
  for (const x of v) {
    if (x > peak) peak = x;
    const dd = peak > 0 ? x / peak - 1 : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}
function meanOf(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function stdOf(a: number[]): number | null {
  if (a.length < 2) return null;
  const m = meanOf(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function sharpeOf(rets: number[]): number | null {
  const sd = stdOf(rets);
  if (sd == null || sd === 0) return null;
  return (meanOf(rets) / sd) * Math.sqrt(TRADING_DAYS);
}
function cagrOf(total: number | null, years: number): number | null {
  if (total == null || total <= -1 || years <= 0) return null;
  return Math.pow(1 + total, 1 / years) - 1;
}
function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    out.push(Number.isFinite(a) && Number.isFinite(b) && a > 0 ? b / a - 1 : 0);
  }
  return out;
}

function emptyMetrics(setups: EngineSetup[]): PortfolioMetrics {
  return {
    nSetups: setups.length,
    nDeals: 0,
    days: 0,
    inMarketDays: 0,
    loading: null,
    start: null,
    end: null,
    years: 0,
    total: null,
    cagr: null,
    maxDD: null,
    vol: null,
    sharpe: null,
    sharpeActive: null,
    returnOnLoading: null,
    spyTotal: null,
    spyCagr: null,
    spyMaxDD: null,
    spySharpe: null,
    excessTotal: null,
    excessCagr: null,
    alphaOnLoading: null,
    sharpeVsSpy: null,
  };
}

/** Объединяет потоки сделок сетапов в дневную кривую капитала и считает метрики. Чистая функция. */
export function buildPortfolio(
  setups: EngineSetup[],
  cfg: EngineConfig,
  spy: Bar[],
  bil: Bar[] | null,
): PortfolioResult {
  const empty: PortfolioResult = { metrics: emptyMetrics(setups), equity: [], benchEquity: [], concurrency: [] };

  const cal = dedupSortBars(spy);
  if (cal.length < 2 || !setups.length) return empty;
  const calDates = cal.map((b) => b.date);
  const spyClose = cal.map((b) => b.close);
  const N = calDates.length;

  // первый торговый день календаря >= date (бинарный поиск по отсортированным датам)
  function firstIndexGE(date: string): number {
    let lo = 0;
    let hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (calDates[mid] < date) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // ставка паркинга простоя по дню k (доходность инструмента между k-1 и k)
  let parkRate: (k: number) => number = () => 0; // CASH
  if (cfg.parking === 'SPY') {
    parkRate = (k) => (spyClose[k - 1] > 0 ? spyClose[k] / spyClose[k - 1] - 1 : 0);
  } else if (cfg.parking === 'BIL' && bil && bil.length >= 2) {
    const bm = new Map(dedupSortBars(bil).map((b) => [b.date, b.close]));
    const bclose: number[] = [];
    let last = NaN;
    for (const d of calDates) {
      if (bm.has(d)) last = bm.get(d)!;
      bclose.push(last);
    }
    parkRate = (k) =>
      Number.isFinite(bclose[k - 1]) && Number.isFinite(bclose[k]) && bclose[k - 1] > 0 ? bclose[k] / bclose[k - 1] - 1 : 0;
  }

  // раскладываем сделки на дни: liveByDay[k] = список живых позиций {rank, rate}
  type Live = { rank: number; rate: number };
  const liveByDay: Live[][] = calDates.map(() => []);
  let nDeals = 0;
  let minEntry = Infinity;
  let maxExit = -Infinity;
  for (const s of setups) {
    const H = Math.max(1, Math.round(s.horizon || 21));
    for (const dl of s.deals || []) {
      if (!dl || !dl.date || !Number.isFinite(dl.ret)) continue;
      const e = firstIndexGE(dl.date);
      if (e >= N) continue; // вход за пределами доступного календаря
      nDeals++;
      const rate = Math.pow(1 + dl.ret / 100, 1 / H) - 1; // геометрическая дневная ставка сделки
      const lastDay = Math.min(e + H, N - 1);
      for (let k = e + 1; k <= lastDay; k++) liveByDay[k].push({ rank: s.rankWeight, rate });
      if (e < minEntry) minEntry = e;
      if (lastDay > maxExit) maxExit = lastDay;
    }
  }
  if (!nDeals || minEntry === Infinity) return empty;

  const start = minEntry;
  const end = Math.max(maxExit, start + 1);
  const K = cfg.maxConcurrent && cfg.maxConcurrent > 0 ? cfg.maxConcurrent : null;

  const equity: DayPoint[] = [{ d: calDates[start], v: 1 }];
  const benchEquity: DayPoint[] = [{ d: calDates[start], v: 1 }];
  const concurrency: number[] = [0];
  const dayRets: number[] = [];
  const activeRets: number[] = [];
  let inMarketDays = 0;
  let v = 1;
  const benchBase = spyClose[start];

  for (let k = start + 1; k <= end; k++) {
    let live = liveByDay[k];
    let m = live.length;
    let dayRet: number;
    if (m > 0) {
      if (K && m > K) {
        live = live.slice().sort((a, b) => b.rank - a.rank).slice(0, K); // топ-K по историческому эджу сетапа
        m = K;
      }
      dayRet = live.reduce((s, x) => s + x.rate, 0) / m; // равный вес среди отобранных, полностью в рынке
      inMarketDays++;
      activeRets.push(dayRet);
    } else {
      dayRet = parkRate(k); // простой → паркинг
    }
    v *= 1 + dayRet;
    dayRets.push(dayRet);
    concurrency.push(m);
    equity.push({ d: calDates[k], v });
    benchEquity.push({ d: calDates[k], v: benchBase > 0 ? spyClose[k] / benchBase : 1 });
  }

  const transitions = end - start; // число дневных доходностей
  const days = end - start + 1;
  const loading = transitions > 0 ? inMarketDays / transitions : null;
  const years = (dts(calDates[end]) - dts(calDates[start])) / (365.25 * 86400);
  const total = v - 1;
  const cagr = cagrOf(total, years);
  const maxDD = maxDrawdown(equity.map((p) => p.v));
  const vol = stdOf(dayRets);
  const sharpe = sharpeOf(dayRets);
  const sharpeActive = sharpeOf(activeRets);

  const spyTotal = benchBase > 0 ? spyClose[end] / benchBase - 1 : null;
  const spyCagr = cagrOf(spyTotal, years);
  const spyMaxDD = maxDrawdown(benchEquity.map((p) => p.v));
  const spySharpe = sharpeOf(dailyReturns(spyClose.slice(start, end + 1)));

  const excessTotal = total != null && spyTotal != null ? total - spyTotal : null;
  const excessCagr = cagr != null && spyCagr != null ? cagr - spyCagr : null;

  const metrics: PortfolioMetrics = {
    nSetups: setups.length,
    nDeals,
    days,
    inMarketDays,
    loading,
    start: calDates[start],
    end: calDates[end],
    years,
    total,
    cagr,
    maxDD,
    vol: vol != null ? vol * Math.sqrt(TRADING_DAYS) : null,
    sharpe,
    sharpeActive,
    returnOnLoading: cagr != null && loading && loading > 0 ? cagr / loading : null,
    spyTotal,
    spyCagr,
    spyMaxDD,
    spySharpe,
    excessTotal,
    excessCagr,
    alphaOnLoading: excessCagr != null && loading && loading > 0 ? excessCagr / loading : null,
    sharpeVsSpy: sharpe != null && spySharpe != null && spySharpe !== 0 ? sharpe / spySharpe : null,
  };

  return { metrics, equity, benchEquity, concurrency };
}
