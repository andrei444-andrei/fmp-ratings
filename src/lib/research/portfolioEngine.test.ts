import { describe, it, expect } from 'vitest';
import { buildPortfolio, type Bar, type EngineSetup, type EngineConfig, type PricePanel, type Signal } from './portfolioEngine';

// Детерминированный календарь/ряд: n подряд идущих дней, цена растёт на dailyRet за день.
function series(n: number, startISO = '2015-01-01', startPrice = 100, dailyRet = 0): Bar[] {
  const out: Bar[] = [];
  let v = startPrice;
  const d = new Date(startISO + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), close: Math.round(v * 1e6) / 1e6 });
    v *= 1 + dailyRet;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const cfg = (execution: EngineConfig['execution'], ladderN: number, parking: EngineConfig['parking']): EngineConfig => ({ execution, ladderN, parking, selection: 'all' });
// сигналы по тикеру на индексах календаря [from..to]
const signalsOn = (dates: string[], from: number, to: number, symbol: string): Signal[] => {
  const out: Signal[] = [];
  for (let i = from; i <= to; i++) out.push({ date: dates[i], symbol });
  return out;
};

describe('buildPortfolio (price-panel simulation)', () => {
  it('лестница: растущий тикер с сигналами каждый день → 100% загрузка, рост, без просадки', () => {
    const spy = series(60, '2015-01-01', 100, 0.0003);
    const dates = spy.map((b) => b.date);
    const aaa = series(60, '2015-01-01', 50, 0.01); // +1%/день
    const panel: PricePanel = new Map([['AAA', aaa]]);
    const setups: EngineSetup[] = [{ id: 's', name: 'S', signals: signalsOn(dates, 10, 40, 'AAA') }];
    const res = buildPortfolio(setups, cfg('ladder', 5, 'CASH'), spy, null, panel);
    expect(res.metrics.nSignals).toBe(31);
    expect(res.metrics.nSymbols).toBe(1);
    // капитальная загрузка = средняя доля развёрнутого капитала (0..1), time-in-market бинарный = 1
    expect(res.metrics.timeInMarket).toBeCloseTo(1, 6);
    expect(res.metrics.loading!).toBeGreaterThan(0.5);
    expect(res.metrics.loading!).toBeLessThanOrEqual(1);
    expect(res.metrics.maxDD).toBe(0);
    expect(res.metrics.total!).toBeGreaterThan(0);
    expect(res.equity.length).toBeGreaterThan(2);
    // загрузка=1 → активный рукав = весь период; inMarket выровнен с кривой
    expect(res.inMarket.length).toBe(res.equity.length);
    expect(res.metrics.activeTotal!).toBeCloseTo(res.metrics.total!, 6);
    expect(res.metrics.excessActive).not.toBeNull();
    // понедельные снимки состава: есть недели с позицией AAA и атрибуцией к сетапу
    expect(res.weeks.length).toBeGreaterThan(0);
    const wk = res.weeks.find((w) => w.positions.length > 0)!;
    expect(wk).toBeTruthy();
    expect(wk.positions[0].symbol).toBe('AAA');
    expect(wk.positions[0].weight).toBeGreaterThan(0);
    expect(wk.positions[0].setups).toContain('S');
    expect(wk.setupsActive).toContain('S');
    // состав по входам лестницы: транш 1/N, доли внутри суммируются к 1, атрибуция к сетапу
    expect(res.rebalances.length).toBeGreaterThan(0);
    const rb = res.rebalances.find((r) => r.positions.length > 0)!;
    expect(rb.kind).toBe('tranche');
    expect(rb.scope).toBeCloseTo(1 / 5, 6);
    expect(rb.positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
    expect(rb.positions[0].setups).toContain('S');
    // доходность решения + SPY за то же окно; SPY-на-загрузке; win-rate vs SPY
    expect(Number.isFinite(rb.ret)).toBe(true);
    expect(Number.isFinite(rb.spyRet)).toBe(true);
    expect(res.benchLoadedEquity.length).toBe(res.equity.length);
    expect(res.metrics.totalTrades).toBeGreaterThan(0);
    expect(res.metrics.winRateVsSpy!).toBeGreaterThan(0.5); // AAA (+1%/д) обгоняет SPY (+0.03%/д)
    // посуточная лента: полная экспозиция дня + сделки; в «полный» день AAA держится на 100% (5 траншей)
    expect(res.days.length).toBeGreaterThan(0);
    const full = res.days.find((d) => d.deployment > 0.99)!;
    expect(full).toBeTruthy();
    expect(full.positions[0].symbol).toBe('AAA');
    expect(full.positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(full.deployment, 6);
    expect(res.days.some((d) => d.bought.length > 0)).toBe(true);
  });

  it('лестница подхватывает залп сигналов N входами подряд → загрузка плавно доходит до 100% (не 1/N)', () => {
    const spy = series(40, '2015-01-01', 100, 0.0003);
    const dates = spy.map((b) => b.date);
    const aaa = series(40, '2015-01-01', 50, 0.004);
    const panel: PricePanel = new Map([['AAA', aaa]]);
    // ОДИН сигнальный день, но лестница из 5 под-портфелей набирает его 5 дней подряд:
    // старая логика (транш = только сигналы дня) дала бы максимум 1/5 = 0.2 загрузки.
    const setups: EngineSetup[] = [{ id: 's', name: 'S', signals: [{ date: dates[10], symbol: 'AAA' }] }];
    const res = buildPortfolio(setups, cfg('ladder', 5, 'CASH'), spy, null, panel);
    const peak = Math.max(...res.deployment);
    expect(peak).toBeGreaterThan(0.9); // подхват трейлинг-окном → выше одиночного транша 0.2
    expect(peak).toBeCloseTo(1, 6); // все 5 под-портфелей держат AAA
    // полная загрузка ровно на 5-й торговый день после сигнала (окно из N под-портфелей заполнено)
    const di = res.deployment.findIndex((d) => d > 0.99);
    expect(res.equity[di].d).toBe(dates[15]);
    // в «полный» день посуточная лента показывает 100% экспозицию в AAA (сумма долей = загрузка)
    const full = res.days.find((d) => d.deployment > 0.99)!;
    expect(full.positions[0].symbol).toBe('AAA');
    expect(full.positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(full.deployment, 6);
  });

  it('метрики «на нагрузку»: SPY считается ТОЛЬКО за дни в рынке (≠ SPY за весь период)', () => {
    const spy = series(80, '2015-01-01', 100, 0.001); // SPY растёт каждый день
    const dates = spy.map((b) => b.date);
    const aaa = series(80, '2015-01-01', 50, 0.002);
    const panel: PricePanel = new Map([['AAA', aaa]]);
    // два сигнала с большим зазором → много дней простоя (загрузка < 0.5)
    const setups: EngineSetup[] = [{ id: 's', name: 'S', signals: [{ date: dates[10], symbol: 'AAA' }, { date: dates[50], symbol: 'AAA' }] }];
    const res = buildPortfolio(setups, cfg('ladder', 5, 'CASH'), spy, null, panel);
    expect(res.metrics.loading!).toBeLessThan(0.5);
    expect(res.metrics.spyActiveTotal).not.toBeNull();
    expect(res.metrics.spyTotal).not.toBeNull();
    // SPY за дни нагрузки заметно отличается от SPY за весь период (растущий зазор не входит в рукав)
    expect(Math.abs(res.metrics.spyActiveTotal! - res.metrics.spyTotal!)).toBeGreaterThan(1e-6);
    expect(res.metrics.activeTotal).not.toBeNull();
    expect(res.metrics.alphaOnLoading).toBe(res.metrics.excessActive); // альфа/загрузка = превышение рукава над SPY(нагр)
  });

  it('недельный ребаланс: один растущий тикер → почти всегда в рынке, доходность положительная', () => {
    const spy = series(80, '2015-01-01', 100, 0.0003);
    const dates = spy.map((b) => b.date);
    const aaa = series(80, '2015-01-01', 50, 0.005);
    const panel: PricePanel = new Map([['AAA', aaa]]);
    const setups: EngineSetup[] = [{ id: 's', name: 'S', signals: signalsOn(dates, 5, 60, 'AAA') }];
    const res = buildPortfolio(setups, cfg('weekly', 5, 'CASH'), spy, null, panel);
    expect(res.metrics.total!).toBeGreaterThan(0);
    expect(res.metrics.loading!).toBeGreaterThan(0.5);
    // периодический режим даёт события ребаланса (scope=1)
    const reb = res.rebalances.find((r) => r.kind === 'rebalance' && r.positions.length > 0)!;
    expect(reb).toBeTruthy();
    expect(reb.scope).toBe(1);
  });

  it('месячный ребаланс на длинном периоде не валится и даёт положительную доходность на растущем тикере', () => {
    const spy = series(140, '2015-01-01', 100, 0.0002);
    const dates = spy.map((b) => b.date);
    const aaa = series(140, '2015-01-01', 50, 0.004);
    const panel: PricePanel = new Map([['AAA', aaa]]);
    const setups: EngineSetup[] = [{ id: 's', name: 'S', signals: signalsOn(dates, 10, 110, 'AAA') }];
    const res = buildPortfolio(setups, cfg('monthly', 5, 'CASH'), spy, null, panel);
    expect(res.metrics.total!).toBeGreaterThan(0);
    expect(res.metrics.start).toBe(dates[10]);
  });

  it('паркинг: пустые слоты лестницы зарабатывают паркинг (SPY обгоняет кэш)', () => {
    const spy = series(40, '2015-01-01', 100, 0.001); // SPY растёт
    const dates = spy.map((b) => b.date);
    const aaa = series(40, '2015-01-01', 50, 0); // тикер ПЛОСКИЙ → реальные слоты дают 0
    const panel: PricePanel = new Map([['AAA', aaa]]);
    const setups: EngineSetup[] = [{ id: 's', name: 'S', signals: [{ date: dates[10], symbol: 'AAA' }] }];
    const cash = buildPortfolio(setups, cfg('ladder', 5, 'CASH'), spy, null, panel);
    const spyp = buildPortfolio(setups, cfg('ladder', 5, 'SPY'), spy, null, panel);
    expect(cash.metrics.total!).toBeCloseTo(0, 6); // плоский тикер + кэш в пустых слотах = 0
    expect(spyp.metrics.total!).toBeGreaterThan(cash.metrics.total!); // пустые слоты «запаркованы» в растущий SPY
  });

  it('пустые входы не валятся', () => {
    const spy = series(30);
    expect(buildPortfolio([], cfg('ladder', 5, 'CASH'), spy, null, new Map()).metrics.nSignals).toBe(0);
    const setups: EngineSetup[] = [{ id: 's', name: 'S', signals: [{ date: spy[5].date, symbol: 'AAA' }] }];
    // нет цен в панели → сделки трактуются как паркинг, не падаем
    expect(buildPortfolio(setups, cfg('weekly', 5, 'CASH'), spy, null, new Map()).metrics.loading).toBe(0);
    // пустой календарь
    expect(buildPortfolio(setups, cfg('ladder', 5, 'CASH'), [], null, new Map()).equity.length).toBe(0);
  });
});
