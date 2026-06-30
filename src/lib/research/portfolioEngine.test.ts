import { describe, it, expect } from 'vitest';
import { buildPortfolio, type Bar, type EngineSetup } from './portfolioEngine';

// Детерминированный календарь «SPY»: n подряд идущих дней с заданным дрейфом (порядок дат — главное,
// движок ищет вход по первому дню >= даты сделки, к дню недели не привязан).
function spySeries(n: number, startISO = '2015-01-01', drift = 0.0005): Bar[] {
  const out: Bar[] = [];
  let v = 100;
  const d = new Date(startISO + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), close: Math.round(v * 1e4) / 1e4 });
    v *= 1 + drift;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const EQUAL = (maxConcurrent: number | null, parking: 'BIL' | 'SPY' | 'CASH') =>
  ({ weighting: 'equal' as const, maxConcurrent, parking });

describe('buildPortfolio', () => {
  it('одна сделка: загрузка 100%, доходность ≈ ret, просадки нет', () => {
    const spy = spySeries(120);
    const setups: EngineSetup[] = [{ id: 'a', name: 'A', horizon: 21, rankWeight: 1, deals: [{ date: spy[10].date, ret: 21 }] }];
    const res = buildPortfolio(setups, EQUAL(null, 'CASH'), spy, null);
    expect(res.metrics.nDeals).toBe(1);
    expect(res.metrics.inMarketDays).toBe(21);
    expect(res.metrics.loading).toBeCloseTo(1, 6);
    expect(res.metrics.total!).toBeCloseTo(0.21, 2);
    expect(res.metrics.maxDD).toBe(0); // монотонный рост → нет просадки
    expect(res.equity.length).toBe(22); // старт + 21 день
    expect(res.equity[0].v).toBe(1);
  });

  it('две непересекающиеся сделки + кэш в простое: загрузка < 1, кэш не меняет эквити', () => {
    const spy = spySeries(200);
    const setups: EngineSetup[] = [
      { id: 'a', name: 'A', horizon: 21, rankWeight: 1, deals: [{ date: spy[10].date, ret: 10 }, { date: spy[100].date, ret: 10 }] },
    ];
    const res = buildPortfolio(setups, EQUAL(null, 'CASH'), spy, null);
    // span: вход[10] → выход[121]; 111 дневных доходностей; в рынке 42 дня (21+21)
    expect(res.metrics.inMarketDays).toBe(42);
    expect(res.metrics.loading!).toBeCloseTo(42 / 111, 6);
    expect(res.metrics.total!).toBeCloseTo(1.1 * 1.1 - 1, 2); // 0.21, кэш в зазоре нейтрален
  });

  it('лимит топ-K=1 отбирает сетап с бо́льшим эджем (без look-ahead по будущей доходности)', () => {
    const spy = spySeries(120);
    const ed = spy[10].date;
    const setups: EngineSetup[] = [
      { id: 'a', name: 'A', horizon: 21, rankWeight: 5, deals: [{ date: ed, ret: 21 }] },
      { id: 'b', name: 'B', horizon: 21, rankWeight: 1, deals: [{ date: ed, ret: -10 }] },
    ];
    const noCap = buildPortfolio(setups, EQUAL(null, 'CASH'), spy, null);
    const cap = buildPortfolio(setups, EQUAL(1, 'CASH'), spy, null);
    expect(cap.metrics.nDeals).toBe(2); // обе сделки учтены как сделки
    expect(cap.metrics.total!).toBeCloseTo(0.21, 2); // остаётся только A (rank 5)
    expect(noCap.metrics.total!).toBeLessThan(cap.metrics.total!); // B (rank 1) тянет среднее вниз
  });

  it('паркинг SPY в простое обгоняет кэш при положительном дрейфе рынка', () => {
    const spy = spySeries(200, '2015-01-01', 0.001);
    const setups: EngineSetup[] = [
      { id: 'a', name: 'A', horizon: 5, rankWeight: 1, deals: [{ date: spy[10].date, ret: 0 }, { date: spy[150].date, ret: 0 }] },
    ];
    const cash = buildPortfolio(setups, EQUAL(null, 'CASH'), spy, null);
    const spyp = buildPortfolio(setups, EQUAL(null, 'SPY'), spy, null);
    expect(cash.metrics.total!).toBeCloseTo(0, 6); // сделки нулевые, кэш нейтрален
    expect(spyp.metrics.total!).toBeGreaterThan(cash.metrics.total!); // зазор «запаркован» в растущий SPY
  });

  it('пустой ввод и пустой календарь не валятся', () => {
    expect(buildPortfolio([], EQUAL(null, 'CASH'), spySeries(50), null).metrics.nDeals).toBe(0);
    const setups: EngineSetup[] = [{ id: 'a', name: 'A', horizon: 21, rankWeight: 1, deals: [{ date: '2015-01-05', ret: 5 }] }];
    expect(buildPortfolio(setups, EQUAL(null, 'CASH'), [], null).equity.length).toBe(0);
  });
});
