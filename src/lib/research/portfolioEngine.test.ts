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
    expect(res.metrics.loading).toBeCloseTo(1, 6);
    expect(res.metrics.maxDD).toBe(0);
    expect(res.metrics.total!).toBeGreaterThan(0);
    expect(res.equity.length).toBeGreaterThan(2);
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
