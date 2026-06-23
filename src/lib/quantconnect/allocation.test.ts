import { describe, it, expect, vi } from 'vitest';
import type { QcTrade } from './types';

// Одна сделка: купили AAPL в начале 2020 и держим (больше ордеров нет).
const TRADES: QcTrade[] = [
  { time: '2020-01-15T00:00:00Z', symbol: 'AAPL', direction: 'buy', quantity: 10, price: 100, value: 1000, type: 'Market', status: 'Filled' },
];

vi.mock('./trades', () => ({
  getStrategyTrades: vi.fn(async () => ({
    id: 1, name: 'X', trades: TRADES, capped: false, total: TRADES.length, error: null, resolvedBacktestId: 'bt',
  })),
}));

// Цены: AAPL растёт быстрее SPY. Месячные точки 2020–2022.
vi.mock('@/lib/research/prices', () => ({
  getPrices: vi.fn(async (sym: string) => {
    const g = sym === 'SPY' ? 0.007 : 0.02;
    const rows: { date: string; close: number }[] = [];
    let p = 100;
    for (let y = 2020; y <= 2022; y++) for (let m = 1; m <= 12; m++) {
      rows.push({ date: `${y}-${String(m).padStart(2, '0')}-28`, close: Math.round(p * 100) / 100 });
      p *= 1 + g;
    }
    return rows;
  }),
}));

import { getStrategyAllocation } from './allocation';

describe('getStrategyAllocation — таймлайн и атрибуция', () => {
  it('таймлайн доводится до конца бэктеста (endIso), хотя сделка одна в 2020', async () => {
    const r = await getStrategyAllocation(1, false, '2022-12-31');
    const years = r.years.map(y => y.year);
    expect(years).toContain(2020);
    expect(years).toContain(2021);
    expect(years).toContain(2022); // не оборвалось на годе последней сделки
    // держим только AAPL → ~100% состава в 2022
    expect(r.years.find(y => y.year === 2022)!.weights['AAPL']).toBeGreaterThan(0.9);
  });

  it('без endIso таймлайн ограничен последней сделкой (документируем поведение)', async () => {
    const r = await getStrategyAllocation(1, false);
    const maxYear = Math.max(...r.years.map(y => y.year));
    expect(maxYear).toBe(2020); // последняя сделка — 2020
  });

  it('атрибуция: тикер, обгонявший SPY, имеет contrib>0 и excess>0', async () => {
    const r = await getStrategyAllocation(1, false, '2022-12-31');
    const aapl = r.attribution.find(a => a.symbol === 'AAPL')!;
    expect(aapl.contrib).toBeGreaterThan(0);
    expect(aapl.spyEquiv).toBeGreaterThan(0);
    expect(aapl.excess).toBeGreaterThan(0); // AAPL рос быстрее SPY
    // разбивка по годам присутствует и покрывает все годы
    expect(r.attributionByYear.map(y => y.year)).toEqual(expect.arrayContaining([2020, 2021, 2022]));
  });
});
