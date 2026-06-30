// Движок раздела «Портфели»: объединение СЕТАПОВ в стратегию и расчёт её совместной доходности.
//
// Модель (две оси):
//  • ОТБОР — кто в портфеле в каждый момент. Кандидаты = имена, у которых сегодня сработал сетап
//    (сигналы входа `(дата, тикер)` из потоков сделок). Сейчас поддержан режим «все имена»; отбор
//    «топ-K экстремумов» подключается, когда в сетапе появится point-in-time ранжирующий фактор;
//    низкокоррелированный отбор — позже.
//  • ИСПОЛНЕНИЕ — как фактически держим/ребалансируем:
//      – ladder N: каждый торговый день вводим 1/N капитала в сегодняшний отбор, транш держим N дней
//        (равный вес среди N перекрывающихся дневных траншей; пустой день → паркинг в этом слоте);
//      – weekly / monthly: на 100% перекладываемся в текущий отбор (имена с сигналом за прошедший
//        период) и держим до следующего ребаланса (buy & hold с дрейфом весов между ребалансами).
//
// P&L, загрузка и просадка считаются по ДНЕВНЫМ ЦЕНАМ (панель передаётся снаружи — роут грузит её
// через getPrices). Срок удержания задаёт ИСПОЛНЕНИЕ, а не горизонт сетапа. Чистые функции.

export type Parking = 'BIL' | 'SPY' | 'CASH';
export type ExecMode = 'ladder' | 'weekly' | 'monthly';
export type EngineConfig = { execution: ExecMode; ladderN: number; parking: Parking; selection: 'all' };

export type Signal = { date: string; symbol: string }; // дата входа + тикер (из потока сделок сетапа)
export type EngineSetup = { id: string; name: string; signals: Signal[] };
export type Bar = { date: string; close: number };
export type DayPoint = { d: string; v: number };
export type PricePanel = Map<string, Bar[]>; // тикер → дневные бары

export type PortfolioMetrics = {
  nSetups: number;
  nSignals: number;
  nSymbols: number;
  days: number;
  inMarketDays: number;
  loading: number | null; // доля торговых дней в рынке (≥1 реальная позиция), 0..1
  avgDeployment: number | null; // средняя доля развёрнутого капитала (для лестницы информативнее)
  start: string | null;
  end: string | null;
  years: number;
  total: number | null;
  cagr: number | null;
  maxDD: number | null;
  vol: number | null;
  sharpe: number | null;
  sharpeActive: number | null;
  returnOnLoading: number | null;
  spyTotal: number | null;
  spyCagr: number | null;
  spyMaxDD: number | null;
  spySharpe: number | null;
  excessTotal: number | null;
  excessCagr: number | null;
  alphaOnLoading: number | null;
  sharpeVsSpy: number | null;
};

export type PortfolioResult = {
  metrics: PortfolioMetrics;
  equity: DayPoint[];
  benchEquity: DayPoint[];
  deployment: number[]; // доля развёрнутого капитала по дням (для графика загрузки)
};

const TRADING_DAYS = 252;
const dts = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

function dedupSortBars(bars: Bar[]): Bar[] {
  const m = new Map<string, number>();
  for (const b of bars) {
    if (!b || !b.date || !Number.isFinite(b.close)) continue;
    m.set(b.date, b.close);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, close]) => ({ date, close }));
}

// Выравнивает бары тикера на торговый календарь carry-forward: цена дня = последний бар с датой ≤ дня.
function alignCF(bars: Bar[], calDates: string[]): number[] {
  const s = dedupSortBars(bars);
  const out = new Array(calDates.length).fill(NaN);
  let j = 0;
  let last = NaN;
  for (let i = 0; i < calDates.length; i++) {
    while (j < s.length && s[j].date <= calDates[i]) {
      last = s[j].close;
      j++;
    }
    out[i] = last;
  }
  return out;
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
const meanOf = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
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
const MIN_YEARS = 1 / 52; // окно < ~недели не аннуализируем — иначе CAGR абсурдно раздувается
function cagrOf(total: number | null, years: number): number | null {
  if (total == null || total <= -1 || years < MIN_YEARS) return null;
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

function emptyMetrics(nSetups: number): PortfolioMetrics {
  return {
    nSetups, nSignals: 0, nSymbols: 0, days: 0, inMarketDays: 0, loading: null, avgDeployment: null,
    start: null, end: null, years: 0, total: null, cagr: null, maxDD: null, vol: null, sharpe: null,
    sharpeActive: null, returnOnLoading: null, spyTotal: null, spyCagr: null, spyMaxDD: null,
    spySharpe: null, excessTotal: null, excessCagr: null, alphaOnLoading: null, sharpeVsSpy: null,
  };
}

const clampN = (n: number) => Math.max(1, Math.min(60, Math.round(n || 5)));

/** Объединяет сигналы сетапов и моделирует портфель по дневным ценам. Чистая функция. */
export function buildPortfolio(
  setups: EngineSetup[],
  cfg: EngineConfig,
  spy: Bar[],
  bil: Bar[] | null,
  panel: PricePanel,
): PortfolioResult {
  const empty: PortfolioResult = { metrics: emptyMetrics(setups.length), equity: [], benchEquity: [], deployment: [] };

  const cal = dedupSortBars(spy);
  if (cal.length < 2 || !setups.length) return empty;
  const calDates = cal.map((b) => b.date);
  const spyClose = cal.map((b) => b.close);
  const N = calDates.length;

  const firstIndexGE = (date: string): number => {
    let lo = 0;
    let hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (calDates[mid] < date) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // сигналы → день входа (индекс календаря) → множество тикеров (объединение сетапов = режим «все»)
  const signalsByDay = new Map<number, Set<string>>();
  const symbols = new Set<string>();
  let nSignals = 0;
  let minEntry = Infinity;
  let lastEntry = -Infinity;
  for (const s of setups) {
    for (const sig of s.signals || []) {
      if (!sig || !sig.date || !sig.symbol) continue;
      const e = firstIndexGE(sig.date);
      if (e >= N) continue;
      const sym = sig.symbol.toUpperCase();
      let set = signalsByDay.get(e);
      if (!set) signalsByDay.set(e, (set = new Set()));
      set.add(sym);
      symbols.add(sym);
      nSignals++;
      if (e < minEntry) minEntry = e;
      if (e > lastEntry) lastEntry = e;
    }
  }
  if (!nSignals || minEntry === Infinity) return empty;

  // цены тикеров, выровненные на календарь (carry-forward)
  const calPrices = new Map<string, number[]>();
  for (const sym of symbols) calPrices.set(sym, alignCF(panel.get(sym) || [], calDates));

  // ставка паркинга простоя
  let parkRate: (k: number) => number = () => 0;
  if (cfg.parking === 'SPY') {
    parkRate = (k) => (spyClose[k - 1] > 0 ? spyClose[k] / spyClose[k - 1] - 1 : 0);
  } else if (cfg.parking === 'BIL' && bil && bil.length >= 2) {
    const bclose = alignCF(bil, calDates);
    parkRate = (k) =>
      Number.isFinite(bclose[k - 1]) && Number.isFinite(bclose[k]) && bclose[k - 1] > 0 ? bclose[k] / bclose[k - 1] - 1 : 0;
  }

  // равновзвешенная дневная доходность корзины (по ценам k-1 → k); NaN, если нет валидных цен
  const eqwReturn = (basket: Set<string>, k: number): number => {
    let sum = 0;
    let c = 0;
    for (const sym of basket) {
      const p = calPrices.get(sym);
      if (!p) continue;
      const a = p[k - 1];
      const b = p[k];
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0) {
        sum += b / a - 1;
        c++;
      }
    }
    return c > 0 ? sum / c : NaN;
  };

  const N_LAD = clampN(cfg.ladderN);
  const maxHold = cfg.execution === 'ladder' ? N_LAD : cfg.execution === 'weekly' ? 5 : 21;
  const start = minEntry;
  const end = Math.min(N - 1, Math.max(lastEntry + maxHold, start + 1));

  const equity: number[] = [1];
  const inMarket: boolean[] = [false];
  const deployment: number[] = [0];
  let v = 1;

  if (cfg.execution === 'ladder') {
    // дневная доходность = среднее по N слотам; слот j соответствует дню входа e = k-j (транш держим N дней)
    for (let k = start + 1; k <= end; k++) {
      let sum = 0;
      let real = 0;
      for (let j = 1; j <= N_LAD; j++) {
        const e = k - j;
        let r: number;
        if (e < start) {
          r = parkRate(k); // капитал ещё не развёрнут → слот в паркинге
        } else {
          const basket = signalsByDay.get(e);
          const br = basket && basket.size ? eqwReturn(basket, k) : NaN;
          if (Number.isFinite(br)) {
            r = br;
            real++;
          } else {
            r = parkRate(k); // пустой день или нет цен → паркинг
          }
        }
        sum += r;
      }
      const dayRet = sum / N_LAD;
      v *= 1 + dayRet;
      equity.push(v);
      inMarket.push(real > 0);
      deployment.push(real / N_LAD);
    }
  } else {
    // периодический ребаланс: на границе недели/месяца на 100% в имена с сигналом за прошедший период
    const keyOf = (k: number): number =>
      cfg.execution === 'weekly'
        ? Math.floor((Date.parse(calDates[k] + 'T00:00:00Z') / 86400000 - 4) / 7) // −4 → границы недели на понедельник
        : Number(calDates[k].slice(0, 7).replace('-', ''));
    let holdings = new Map<string, number>(); // тикер → «юниты» (кол-во относительно номинала)
    let cash = 1;
    let prevReb = start - 1;

    const rebalance = (k: number) => {
      const eq = cash + [...holdings.entries()].reduce((s, [sym, u]) => {
        const p = calPrices.get(sym)?.[k];
        return s + (Number.isFinite(p as number) ? u * (p as number) : 0);
      }, 0);
      // корзина = тикеры с сигналом в (prevReb, k]
      const basket = new Set<string>();
      for (let e = prevReb + 1; e <= k; e++) {
        const set = signalsByDay.get(e);
        if (set) for (const s of set) basket.add(s);
      }
      const valid = [...basket].filter((s) => Number.isFinite(calPrices.get(s)?.[k] as number) && (calPrices.get(s)![k] as number) > 0);
      holdings = new Map();
      if (valid.length) {
        const per = eq / valid.length;
        for (const s of valid) holdings.set(s, per / (calPrices.get(s)![k] as number));
        cash = 0;
      } else {
        cash = eq;
      }
      prevReb = k;
    };

    rebalance(start); // первый ребаланс на старте
    for (let k = start + 1; k <= end; k++) {
      cash *= 1 + parkRate(k); // паркинг на свободном кэше
      if (keyOf(k) !== keyOf(k - 1)) rebalance(k);
      let hv = 0;
      for (const [sym, u] of holdings) {
        const p = calPrices.get(sym)?.[k];
        if (Number.isFinite(p as number)) hv += u * (p as number);
      }
      v = cash + hv;
      equity.push(v);
      inMarket.push(hv > 0);
      deployment.push(v > 0 ? hv / v : 0);
    }
  }

  // метрики из дневной кривой
  const dayRets: number[] = [];
  const activeRets: number[] = [];
  let inMarketDays = 0;
  for (let i = 1; i < equity.length; i++) {
    const r = equity[i] / equity[i - 1] - 1;
    dayRets.push(r);
    if (inMarket[i]) {
      inMarketDays++;
      activeRets.push(r);
    }
  }
  const transitions = equity.length - 1;
  const loading = transitions > 0 ? inMarketDays / transitions : null;
  const years = (dts(calDates[end]) - dts(calDates[start])) / (365.25 * 86400);
  const total = v - 1;
  const cagr = cagrOf(total, years);

  const benchBase = spyClose[start];
  const benchEquity: DayPoint[] = [];
  for (let k = start; k <= end; k++) benchEquity.push({ d: calDates[k], v: benchBase > 0 ? spyClose[k] / benchBase : 1 });
  const spyTotal = benchBase > 0 ? spyClose[end] / benchBase - 1 : null;
  const spyCagr = cagrOf(spyTotal, years);
  const spySharpe = sharpeOf(dailyReturns(spyClose.slice(start, end + 1)));

  const sharpe = sharpeOf(dayRets);
  const vol = stdOf(dayRets);
  const excessTotal = total != null && spyTotal != null ? total - spyTotal : null;
  const excessCagr = cagr != null && spyCagr != null ? cagr - spyCagr : null;

  const metrics: PortfolioMetrics = {
    nSetups: setups.length,
    nSignals,
    nSymbols: symbols.size,
    days: end - start + 1,
    inMarketDays,
    loading,
    avgDeployment: deployment.length > 1 ? meanOf(deployment.slice(1)) : null,
    start: calDates[start],
    end: calDates[end],
    years,
    total,
    cagr,
    maxDD: maxDrawdown(equity),
    vol: vol != null ? vol * Math.sqrt(TRADING_DAYS) : null,
    sharpe,
    sharpeActive: sharpeOf(activeRets),
    returnOnLoading: cagr != null && loading && loading > 0 ? cagr / loading : null,
    spyTotal,
    spyCagr,
    spyMaxDD: maxDrawdown(benchEquity.map((p) => p.v)),
    spySharpe,
    excessTotal,
    excessCagr,
    alphaOnLoading: excessCagr != null && loading && loading > 0 ? excessCagr / loading : null,
    sharpeVsSpy: sharpe != null && spySharpe != null && spySharpe > 0 ? sharpe / spySharpe : null, // отношение осмысленно лишь при положительном Sharpe SPY
  };

  const equityPts: DayPoint[] = equity.map((vv, i) => ({ d: calDates[start + i], v: vv }));
  return { metrics, equity: equityPts, benchEquity, deployment };
}
