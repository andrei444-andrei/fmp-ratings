// Движок раздела «Портфели»: объединение СЕТАПОВ в стратегию и расчёт её совместной доходности.
//
// Модель (две оси):
//  • ОТБОР — кто в портфеле в каждый момент. Кандидаты = имена, у которых сегодня сработал сетап
//    (сигналы входа `(дата, тикер)` из потоков сделок). Сейчас поддержан режим «все имена»; отбор
//    «топ-K экстремумов» подключается, когда в сетапе появится point-in-time ранжирующий фактор;
//    низкокоррелированный отбор — позже.
//  • ИСПОЛНЕНИЕ — как фактически держим/ребалансируем:
//      – ladder N: каждый торговый день ОДИН из N под-портфелей (1/N капитала) полностью
//        перекладывается в ТЕКУЩИЙ отбор (имена с сигналом за трейлинг-окно N дней — та же логика,
//        что у периодического ребаланса) и держит N дней. Итог = N параллельных под-портфелей,
//        сдвинутых по фазе на день: одиночный залп сигналов подхватывается N входами подряд, так что
//        загрузка плавно набирается к 100% и плавно снимается (сглаживание входа/выхода). Пусто → паркинг;
//      – weekly / monthly: на 100% перекладываемся в текущий отбор (имена с сигналом за прошедший
//        период) и держим до следующего ребаланса (buy & hold с дрейфом весов между ребалансами).
//
// P&L, загрузка и просадка считаются по ДНЕВНЫМ ЦЕНАМ (панель передаётся снаружи — роут грузит её
// через getPrices). Срок удержания задаёт ИСПОЛНЕНИЕ, а не горизонт сетапа. Чистые функции.

export type Parking = 'BIL' | 'SPY' | 'CASH';
export type ExecMode = 'ladder' | 'weekly' | 'monthly';
// maxWeight — потолок веса на 1 тикер (доля 0..1); 0 = без лимита. Если равный вес превысил бы потолок
// (имён мало), каждое имя капается на maxWeight, а неразмещённый остаток уходит в паркинг.
// maxLeverage — макс. плечо (1 = без плеча). Доля на имя = min(L/m, потолок), итог = min(L, m·потолок):
// >100% набирается только когда имён достаточно; лишнее финансируется маржой по ставке паркинга.
// При SPY-паркинге плечо не используется (капитал и так в рынке) → L форсируется в 1.
export type EngineConfig = { execution: ExecMode; ladderN: number; parking: Parking; selection: 'all'; maxWeight: number; maxLeverage: number };

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
  loading: number | null; // КАПИТАЛЬНАЯ загрузка: средняя доля капитала в активах (не BIL), 0..1
  timeInMarket: number | null; // доля торговых дней с ≥1 позицией (бинарный time-in-market)
  avgDeployment: number | null; // = loading (оставлено для совместимости)
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
  excessTotal: number | null; // total − spyTotal (за весь период)
  excessCagr: number | null;
  alphaOnLoading: number | null; // = excessActive (превышение рукава над SPY за дни нагрузки)
  sharpeVsSpy: number | null; // sharpe ÷ spySharpe (весь период)
  // «на нагрузку»: сравнение с SPY ТОЛЬКО за дни, когда стратегия в рынке (активный рукав)
  activeTotal: number | null; // доходность активного рукава (произведение по дням в рынке)
  spyActiveTotal: number | null; // SPY ровно за те же дни нагрузки
  excessActive: number | null; // activeTotal − spyActiveTotal (превышение vs SPY на нагрузку)
  spySharpeActive: number | null; // Sharpe SPY по дням нагрузки
  sharpeVsSpyActive: number | null; // sharpeActive ÷ spySharpeActive
  winRateVsSpy: number | null; // доля сделок (ребалансов/входов), обогнавших SPY за то же окно
  winTrades: number; // сколько сделок обогнали SPY
  totalTrades: number; // всего сделок с составом
};

export type WeekPosition = { symbol: string; weight: number; days: number; setups: string[] }; // ср. вес за неделю, дней держания, какие сетапы дали имя
export type WeekSnapshot = {
  start: string; // понедельник недели
  end: string; // последний торговый день недели в периоде
  loading: number; // доля дней недели в рынке
  ret: number; // доходность портфеля за неделю
  spyRet: number; // SPY за неделю
  parkingShare: number; // средняя доля в паркинге за неделю
  positions: WeekPosition[]; // что держалось (топ по весу)
  setupsActive: string[]; // сетапы, давшие имена на этой неделе (причина экспозиции)
};

// Состав, взятый в конкретный ребаланс (периодический) или вход-транш (лестница): тикеры с долями.
export type RebalancePos = { symbol: string; weight: number; setups: string[] };
export type RebalanceEvent = {
  date: string;
  kind: 'rebalance' | 'tranche'; // ребаланс (100%) или дневной вход лестницы (1/N капитала)
  scope: number; // доля капитала этого решения (1 для ребаланса, 1/N для лестницы)
  positions: RebalancePos[]; // доли ВНУТРИ решения (сумма ≈ 1)
  ret: number; // доходность этого решения за его окно удержания
  spyRet: number; // SPY за то же окно (для сравнения / win-rate)
};

// Посуточный снимок: ПОЛНАЯ экспозиция дня + сделки (что куплено/продано в этот день).
export type DayTrade = { symbol: string; weight: number };
export type DayPos = { symbol: string; weight: number }; // лёгкая позиция дня (сетапы — в symSetups результата)
export type DaySnapshot = {
  date: string;
  deployment: number; // доля капитала в активах (не BIL)
  parking: number; // доля в паркинге/BIL
  ret: number; // доходность портфеля за день
  spyRet: number; // SPY за этот день
  positions: DayPos[]; // полная экспозиция дня (все активные транши/холдинги)
  bought: DayTrade[]; // изменения состава: вошло сегодня
  sold: DayTrade[]; // изменения состава: вышло сегодня
};

export type PortfolioResult = {
  metrics: PortfolioMetrics;
  equity: DayPoint[];
  benchEquity: DayPoint[];
  benchLoadedEquity: DayPoint[]; // SPY «на той же загрузке»: держим SPY в той же капитальной пропорции, иначе паркинг (старт = 1)
  deployment: number[]; // доля развёрнутого капитала в СЕТАПЫ по дням (для состава/экспозиции)
  loadingByDay: number[]; // капитальная загрузка по дням под рыночным риском (SPY-паркинг = в рынке)
  inMarket: boolean[]; // по дням: открыта ли ≥1 реальная позиция (для разбивки загрузки по периодам)
  weeks: WeekSnapshot[]; // понедельные снимки состава (для drill-down: что держится + % + причины)
  rebalances: RebalanceEvent[]; // состав по каждому ребалансу/входу (тикеры + доли + доходность)
  days: DaySnapshot[]; // посуточная экспозиция + сделки (полная реальная экспозиция каждого дня)
  symSetups: Record<string, string[]>; // тикер → сетапы (один раз на результат; для «причин» без дублирования по дням)
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
    nSetups, nSignals: 0, nSymbols: 0, days: 0, inMarketDays: 0, loading: null, timeInMarket: null, avgDeployment: null,
    start: null, end: null, years: 0, total: null, cagr: null, maxDD: null, vol: null, sharpe: null,
    sharpeActive: null, returnOnLoading: null, spyTotal: null, spyCagr: null, spyMaxDD: null,
    spySharpe: null, excessTotal: null, excessCagr: null, alphaOnLoading: null, sharpeVsSpy: null,
    activeTotal: null, spyActiveTotal: null, excessActive: null, spySharpeActive: null, sharpeVsSpyActive: null,
    winRateVsSpy: null, winTrades: 0, totalTrades: 0,
  };
}

const clampN = (n: number) => Math.max(1, Math.min(60, Math.round(n || 5)));

// Вес на 1 имя (доля капитала) при равном весе с потолком maxW и плечом L.
// per = min(L/m, C), где C = maxW (или 1 без лимита). Размещённая доля = per·m = min(L, m·C):
// >1 (плечо) только когда имён достаточно; <1 → остаток в паркинг. L=1, maxW=0 → per = 1/m (как раньше).
const cappedPerWeight = (m: number, maxW: number, L = 1): number => (m <= 0 ? 0 : Math.min(L / m, maxW > 0 ? maxW : 1));

/** Объединяет сигналы сетапов и моделирует портфель по дневным ценам. Чистая функция. */
export function buildPortfolio(
  setups: EngineSetup[],
  cfg: EngineConfig,
  spy: Bar[],
  bil: Bar[] | null,
  panel: PricePanel,
): PortfolioResult {
  const empty: PortfolioResult = { metrics: emptyMetrics(setups.length), equity: [], benchEquity: [], benchLoadedEquity: [], deployment: [], loadingByDay: [], inMarket: [], weeks: [], rebalances: [], days: [], symSetups: {} };

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
  const symbolToSetups = new Map<string, Set<string>>(); // тикер → какие сетапы его давали (для «почему»)
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
      let ss = symbolToSetups.get(sym);
      if (!ss) symbolToSetups.set(sym, (ss = new Set()));
      ss.add(s.name);
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

  // тикеры корзины с валидной ценой на день k (для назначения весов состава)
  const basketValid = (basket: Set<string>, k: number): string[] => {
    const out: string[] = [];
    for (const sym of basket) {
      const p = calPrices.get(sym);
      if (p && Number.isFinite(p[k - 1]) && Number.isFinite(p[k]) && p[k - 1] > 0) out.push(sym);
    }
    return out;
  };

  const N_LAD = clampN(cfg.ladderN);
  const maxW = cfg.maxWeight > 0 && cfg.maxWeight < 1 ? cfg.maxWeight : 0; // потолок веса на тикер (0 = off)
  // плечо: при SPY-паркинге не используется (капитал уже в рынке); иначе клампим в [1, 3]
  const L = cfg.parking === 'SPY' ? 1 : Math.max(1, Math.min(3, cfg.maxLeverage || 1));

  // Лестница: корзина под-портфеля, ребалансированного на день входа e = «текущий отбор» —
  // имена с сигналом за трейлинг-окно N дней (e−N+1..e). Та же логика, что у периодического
  // ребаланса, но для одного из N сдвинутых по фазе под-портфелей. Мемоизируется по e.
  const trancheCache = new Map<number, Set<string>>();
  const trancheBasket = (e: number): Set<string> => {
    let b = trancheCache.get(e);
    if (b) return b;
    b = new Set<string>();
    for (let t = Math.max(0, e - N_LAD + 1); t <= e; t++) {
      const set = signalsByDay.get(t);
      if (set) for (const s of set) b.add(s);
    }
    trancheCache.set(e, b);
    return b;
  };

  const maxHold = cfg.execution === 'ladder' ? N_LAD : cfg.execution === 'weekly' ? 5 : 21;
  const start = minEntry;
  const end = Math.min(N - 1, Math.max(lastEntry + maxHold, start + 1));

  const equity: number[] = [1];
  const inMarket: boolean[] = [false];
  const deployment: number[] = [0];
  const dayWeights: Map<string, number>[] = [new Map()]; // по дням: тикер → вес в портфеле
  const dayParking: number[] = [1]; // по дням: доля в паркинге
  const rebalances: RebalanceEvent[] = []; // состав по ребалансам/входам
  const setupsOf = (s: string): string[] => [...(symbolToSetups.get(s) || [])];
  let v = 1;

  if (cfg.execution === 'ladder') {
    // дневная доходность = среднее по N слотам; слот j соответствует дню входа e = k-j (транш держим N дней)
    for (let k = start + 1; k <= end; k++) {
      let sum = 0;
      let depSum = 0; // Σ размещённой доли по слотам (каждая ≤ 1) → капитал в именах
      const wmap = new Map<string, number>();
      let park = 0;
      for (let j = 1; j <= N_LAD; j++) {
        const e = k - j;
        if (e < start) {
          sum += parkRate(k); // капитал ещё не развёрнут → слот в паркинге
          park += 1 / N_LAD;
          continue;
        }
        const basket = trancheBasket(e); // текущий отбор под-портфеля, вошедшего на день e
        const valid = basket.size ? basketValid(basket, k) : [];
        const m = valid.length;
        if (m) {
          const per = cappedPerWeight(m, maxW, L); // доля слота на 1 имя (потолок + плечо)
          const deployed = per * m; // размещённая доля слота (может быть >1 при плече; <1 → в паркинг)
          let sr = 0;
          for (const s of valid) {
            const p = calPrices.get(s)!;
            sr += p[k] / p[k - 1] - 1;
          }
          // доходность слота = per·Σ(доходность имён) + (1−deployed)·паркинг. При deployed>1 остаток < 0 —
          // это маржа: платим ставку паркинга (BIL/кэш) на заёмную часть.
          sum += per * sr + (1 - deployed) * parkRate(k);
          depSum += deployed;
          park += (1 - deployed) / N_LAD;
          const w = per / N_LAD; // вес имени в ПОРТФЕЛЕ (слот = 1/N капитала)
          for (const s of valid) wmap.set(s, (wmap.get(s) || 0) + w);
        } else {
          sum += parkRate(k); // пустой день или нет цен → паркинг
          park += 1 / N_LAD;
        }
      }
      const dayRet = sum / N_LAD;
      v *= 1 + dayRet;
      equity.push(v);
      inMarket.push(depSum > 0);
      deployment.push(depSum / N_LAD);
      dayWeights.push(wmap);
      dayParking.push(Math.max(0, park)); // при плече остаток отрицателен (маржа) → для отображения 0
    }
    // входы лестницы: каждый торговый день один под-портфель (1/N капитала) ребалансируется в
    // ТЕКУЩИЙ отбор (трейлинг-окно N дней) и держит N дней; равные доли среди имён отбора.
    for (let e = start; e < end; e++) {
      const basket = trancheBasket(e);
      if (!basket.size) continue;
      const names = [...basket];
      const per = cappedPerWeight(names.length, maxW, L); // доля на имя (потолок + плечо)
      rebalances.push({
        date: calDates[e],
        kind: 'tranche',
        scope: 1 / N_LAD,
        positions: names.map((s) => ({ symbol: s, weight: per, setups: setupsOf(s) })),
        ret: 0,
        spyRet: 0,
      });
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
      const m = valid.length;
      const w = cappedPerWeight(m, maxW, L); // доля капитала на 1 имя (потолок + плечо)
      if (m) {
        for (const s of valid) holdings.set(s, (eq * w) / (calPrices.get(s)![k] as number));
        cash = eq * (1 - w * m); // <1 → остаток в паркинг; при плече (>1) cash < 0 = маржа (заём под ставку паркинга)
      } else {
        cash = eq;
      }
      rebalances.push({
        date: calDates[k],
        kind: 'rebalance',
        scope: m ? 1 : 0,
        positions: valid.map((s) => ({ symbol: s, weight: w, setups: setupsOf(s) })),
        ret: 0,
        spyRet: 0,
      });
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
      const wmap = new Map<string, number>();
      for (const [sym, u] of holdings) {
        const p = calPrices.get(sym)?.[k];
        if (Number.isFinite(p as number) && v > 0) wmap.set(sym, (u * (p as number)) / v);
      }
      dayWeights.push(wmap);
      dayParking.push(v > 0 ? Math.max(0, cash / v) : 0); // при плече cash < 0 (маржа) → для отображения 0
    }
  }

  // метрики из дневной кривой. Параллельно копим «активный рукав»: доходность стратегии и SPY
  // ТОЛЬКО по дням, когда стратегия в рынке (для корректного сравнения «на нагрузку»).
  const dayRets: number[] = [];
  const activeRets: number[] = [];
  const spyActiveRets: number[] = [];
  let inMarketDays = 0;
  let activeProd = 1;
  let spyActiveProd = 1;
  for (let i = 1; i < equity.length; i++) {
    const r = equity[i] / equity[i - 1] - 1;
    dayRets.push(r);
    if (inMarket[i]) {
      inMarketDays++;
      activeRets.push(r);
      activeProd *= 1 + r;
      const k = start + i;
      const sa = spyClose[k - 1] > 0 ? spyClose[k] / spyClose[k - 1] - 1 : 0;
      spyActiveRets.push(sa);
      spyActiveProd *= 1 + sa;
    }
  }
  const transitions = equity.length - 1;
  // КАПИТАЛЬНАЯ загрузка: средняя доля капитала под РЫНОЧНЫМ риском по всем торговым дням.
  // BIL/кэш — безрисковый паркинг (НЕ загрузка); SPY-паркинг — тоже рынок, поэтому в этом режиме
  // простаивающий капитал считается загруженным (deployment + доля в паркинге ≈ 1 → загрузка ≈ 100%).
  const parkedIsMarket = cfg.parking === 'SPY';
  const loadingByDay = deployment.map((d, i) => (parkedIsMarket ? Math.min(1, (d ?? 0) + (dayParking[i] ?? 0)) : (d ?? 0)));
  const loading = transitions > 0 ? meanOf(loadingByDay.slice(1)) : null;
  const timeInMarket = transitions > 0 ? inMarketDays / transitions : null; // бинарный time-in-market (для справки)
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

  // активный рукав vs SPY за дни нагрузки
  const sharpeActive = sharpeOf(activeRets);
  const activeTotal = inMarketDays ? activeProd - 1 : null;
  const spyActiveTotal = inMarketDays ? spyActiveProd - 1 : null;
  const excessActive = activeTotal != null && spyActiveTotal != null ? activeTotal - spyActiveTotal : null;
  const spySharpeActive = sharpeOf(spyActiveRets);
  const sharpeVsSpyActive = sharpeActive != null && spySharpeActive != null && spySharpeActive > 0 ? sharpeActive / spySharpeActive : null;

  // SPY «на той же загрузке»: каждый день держим SPY в ТОЙ ЖЕ капитальной пропорции (deployment[i]),
  // остальное — в паркинге (как у стратегии).
  const benchLoadedEquity: DayPoint[] = [{ d: calDates[start], v: 1 }];
  {
    let lv = 1;
    for (let i = 1; i < equity.length; i++) {
      const k = start + i;
      const dep = Math.max(0, Math.min(1, deployment[i] ?? 0));
      const spyDay = spyClose[k - 1] > 0 ? spyClose[k] / spyClose[k - 1] - 1 : 0;
      const r = dep * spyDay + (1 - dep) * parkRate(k);
      lv *= 1 + r;
      benchLoadedEquity.push({ d: calDates[k], v: lv });
    }
  }

  // доходность каждого решения (ребаланс/вход) за его окно удержания + SPY за то же окно
  const eqwWindow = (syms: string[], a: number, b: number): number => {
    let sum = 0;
    let c = 0;
    for (const s of syms) {
      const p = calPrices.get(s);
      if (p && Number.isFinite(p[a]) && Number.isFinite(p[b]) && p[a] > 0) {
        sum += p[b] / p[a] - 1;
        c++;
      }
    }
    return c > 0 ? sum / c : 0;
  };
  for (let j = 0; j < rebalances.length; j++) {
    const ev = rebalances[j];
    const kj = firstIndexGE(ev.date);
    if (kj >= N) continue;
    const exit = ev.kind === 'rebalance'
      ? (j + 1 < rebalances.length ? firstIndexGE(rebalances[j + 1].date) : end) // до следующего ребаланса
      : Math.min(kj + N_LAD, end); // транш: N дней
    ev.ret = ev.kind === 'rebalance'
      ? (equity[kj - start] > 0 ? equity[exit - start] / equity[kj - start] - 1 : 0) // портфель 100% в корзине
      : eqwWindow(ev.positions.map((p) => p.symbol), kj, exit); // равновзвешенный buy&hold корзины входа
    ev.spyRet = spyClose[kj] > 0 ? spyClose[exit] / spyClose[kj] - 1 : 0;
  }
  const tradedEvents = rebalances.filter((r) => r.positions.length > 0);
  const winTrades = tradedEvents.filter((r) => r.ret > r.spyRet).length;
  const totalTrades = tradedEvents.length;
  const winRateVsSpy = totalTrades ? winTrades / totalTrades : null;

  const metrics: PortfolioMetrics = {
    nSetups: setups.length,
    nSignals,
    nSymbols: symbols.size,
    days: end - start + 1,
    inMarketDays,
    loading,
    timeInMarket,
    avgDeployment: loading,
    start: calDates[start],
    end: calDates[end],
    years,
    total,
    cagr,
    maxDD: maxDrawdown(equity),
    vol: vol != null ? vol * Math.sqrt(TRADING_DAYS) : null,
    sharpe,
    sharpeActive,
    returnOnLoading: cagr != null && loading && loading > 0 ? cagr / loading : null,
    spyTotal,
    spyCagr,
    spyMaxDD: maxDrawdown(benchEquity.map((p) => p.v)),
    spySharpe,
    excessTotal,
    excessCagr,
    alphaOnLoading: excessActive, // «альфа на нагрузку» = превышение рукава над SPY за дни нагрузки
    sharpeVsSpy: sharpe != null && spySharpe != null && spySharpe > 0 ? sharpe / spySharpe : null, // отношение осмысленно лишь при положительном Sharpe SPY
    activeTotal,
    spyActiveTotal,
    excessActive,
    spySharpeActive,
    sharpeVsSpyActive,
    winRateVsSpy,
    winTrades,
    totalTrades,
  };

  // понедельные снимки состава (drill-down: что держится + % экспозиции + причины)
  const weekKeyOf = (calIdx: number): number => Math.floor((Date.parse(calDates[calIdx] + 'T00:00:00Z') / 86400000 - 4) / 7);
  const weeks: WeekSnapshot[] = [];
  {
    let a = 0;
    let curWk = weekKeyOf(start);
    const flushWeek = (b: number) => {
      const wAgg = new Map<string, { w: number; days: number }>();
      let parkSum = 0;
      let inm = 0;
      let cnt = 0;
      const from = Math.max(a, 1);
      for (let i = from; i <= b; i++) {
        cnt++;
        if (inMarket[i]) inm++;
        parkSum += dayParking[i] ?? 0;
        const wm = dayWeights[i];
        if (wm) for (const [s, w] of wm) {
          const e = wAgg.get(s) || { w: 0, days: 0 };
          e.w += w;
          if (w > 0) e.days++;
          wAgg.set(s, e);
        }
      }
      if (cnt === 0) return;
      const baseIdx = a === 0 ? 0 : a - 1;
      const ret = equity[baseIdx] > 0 ? equity[b] / equity[baseIdx] - 1 : 0;
      const sBase = spyClose[start + baseIdx];
      const spyRet = sBase > 0 ? spyClose[start + b] / sBase - 1 : 0;
      const positions: WeekPosition[] = [...wAgg.entries()]
        .map(([symbol, e]) => ({ symbol, weight: e.w / cnt, days: e.days, setups: [...(symbolToSetups.get(symbol) || [])] }))
        .filter((p) => p.weight > 1e-6)
        .sort((x, y) => y.weight - x.weight)
        .slice(0, 30);
      weeks.push({
        start: new Date((curWk * 7 + 4) * 86400000).toISOString().slice(0, 10),
        end: calDates[start + b],
        loading: cnt ? inm / cnt : 0,
        ret,
        spyRet,
        parkingShare: cnt ? parkSum / cnt : 0,
        positions,
        setupsActive: [...new Set(positions.flatMap((p) => p.setups))],
      });
    };
    for (let i = 1; i < equity.length; i++) {
      const wk = weekKeyOf(start + i);
      if (wk !== curWk) { flushWeek(i - 1); a = i; curWk = wk; }
    }
    flushWeek(equity.length - 1);
  }

  // посуточная лента: ПОЛНАЯ экспозиция каждого дня + изменения состава (куплено/продано).
  // Экспозиция дня k = веса активных траншей/холдингов (dayWeights). Изменения vs вчера:
  //  лестница — вошёл под-портфель (трейлинг-отбор дня k-1, стал живым сегодня), вышел под-портфель дня k-1-N; каждый (1/N)/m.
  //  ребаланс — на день ребаланса продаём вчерашний состав, покупаем новый; иначе изменений нет.
  // весь период (не режем годы); payload лёгкий — сетапы в symSetups, а не в каждом дне
  const DAYS_CAP = 10000;
  const rebDaySet = new Set<number>();
  if (cfg.execution !== 'ladder') for (const ev of rebalances) rebDaySet.add(firstIndexGE(ev.date));
  const days: DaySnapshot[] = [];
  const fromDay = Math.max(1, equity.length - DAYS_CAP);
  const posOf = (wm: Map<string, number>): DayPos[] =>
    [...wm.entries()].filter(([, w]) => w > 1e-6).sort((x, y) => y[1] - x[1]).map(([symbol, weight]) => ({ symbol, weight }));
  for (let i = fromDay; i < equity.length; i++) {
    const k = start + i;
    let bought: DayTrade[] = [];
    let sold: DayTrade[] = [];
    if (cfg.execution === 'ladder') {
      const bd = k - 1 >= start ? trancheBasket(k - 1) : null; // под-портфель, вошедший сегодня
      if (bd && bd.size) { const w = cappedPerWeight(bd.size, maxW, L) / N_LAD; bought = [...bd].map((s) => ({ symbol: s, weight: w })); }
      const se = k - 1 - N_LAD;
      const sd = se >= start ? trancheBasket(se) : null; // под-портфель, истёкший сегодня
      if (sd && sd.size) { const w = cappedPerWeight(sd.size, maxW, L) / N_LAD; sold = [...sd].map((s) => ({ symbol: s, weight: w })); }
    } else if (rebDaySet.has(k)) {
      const prev = dayWeights[i - 1] || new Map();
      sold = [...prev.entries()].filter(([, w]) => w > 1e-6).map(([symbol, weight]) => ({ symbol, weight }));
      bought = [...(dayWeights[i] || new Map()).entries()].filter(([, w]) => w > 1e-6).map(([symbol, weight]) => ({ symbol, weight }));
    }
    days.push({
      date: calDates[k],
      deployment: deployment[i] ?? 0,
      parking: dayParking[i] ?? 0,
      ret: equity[i - 1] > 0 ? equity[i] / equity[i - 1] - 1 : 0,
      spyRet: spyClose[k - 1] > 0 ? spyClose[k] / spyClose[k - 1] - 1 : 0,
      positions: posOf(dayWeights[i] || new Map()),
      bought,
      sold,
    });
  }

  const equityPts: DayPoint[] = equity.map((vv, i) => ({ d: calDates[start + i], v: vv }));
  const symSetups: Record<string, string[]> = {};
  for (const [sym, set] of symbolToSetups) symSetups[sym] = [...set];
  return { metrics, equity: equityPts, benchEquity, benchLoadedEquity, deployment, loadingByDay, inMarket, weeks, rebalances: rebalances.slice(-1500), days, symSetups };
}
