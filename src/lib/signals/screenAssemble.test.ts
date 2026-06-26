import { describe, it, expect } from 'vitest';
import { assembleUniverse, splitEngineResult, type TickerPanel } from './screenAssemble';

// Результат движка screen (как из Pyodide): rows = [symIdx, dateIdx, fwd, v0, v1]
const ENG = {
  symbols: ['AAA', 'BBB'],
  dates: ['2020-01-10', '2020-06-10', '2021-01-10'],
  cols: ['mom_63', 'vol_21'],
  rows: [
    [0, 0, 1.2, 5.0, 12.0],
    [0, 2, -0.5, -3.0, 18.0],
    [1, 1, 2.1, 9.0, 10.0],
    [1, 2, 0.3, 1.0, 14.0],
  ] as (number | null)[][],
};

describe('screenAssemble', () => {
  it('split: разбивает результат движка на per-ticker наблюдения, отсортированные по дате', () => {
    const { cols, perTicker } = splitEngineResult(ENG);
    expect(cols).toEqual(['mom_63', 'vol_21']);
    expect(perTicker.get('AAA')!.length).toBe(2);
    expect(perTicker.get('BBB')!.length).toBe(2);
    // AAA: [date, fwd, mom, vol]
    expect(perTicker.get('AAA')![0]).toEqual(['2020-01-10', 1.2, 5.0, 12.0]);
    expect(perTicker.get('AAA')![1][0]).toBe('2021-01-10');
  });

  it('round-trip: split → (как кэш) → assemble воспроизводит панель эквивалентно', () => {
    const { cols, perTicker } = splitEngineResult(ENG);
    const cacheMap = new Map<string, TickerPanel>();
    for (const [s, obs] of perTicker) cacheMap.set(s, { cols, obs, first: '', last: '' });
    const panel = assembleUniverse(['AAA', 'BBB'], 21, cacheMap, cols);
    expect(panel.cols).toEqual(cols);
    expect(panel.symbols).toEqual(['AAA', 'BBB']);
    expect(panel.rows.length).toBe(ENG.rows.length);
    // глобальные даты — объединение, отсортированы
    expect(panel.dates).toEqual(['2020-01-10', '2020-06-10', '2021-01-10']);
    // каждая строка: [symIdx, dateIdx, fwd, mom, vol] — fwd и факторы сохранены
    const fwds = panel.rows.map((r) => r[2]).sort();
    expect(fwds).toEqual([-0.5, 0.3, 1.2, 2.1].sort());
    // dateIdx указывает в panel.dates корректно
    for (const r of panel.rows) {
      const sym = panel.symbols[r[0] as number];
      const date = panel.dates[r[1] as number];
      const ref = ENG.rows.find((er) => ENG.symbols[er[0] as number] === sym && ENG.dates[er[1] as number] === date)!;
      expect(r[2]).toBe(ref[2]); // fwd
      expect(r[3]).toBe(ref[3]); // mom
    }
  });

  it('assemble: пропускает тикеры без данных, индексы согласованы', () => {
    const cacheMap = new Map<string, TickerPanel>();
    cacheMap.set('AAA', { cols: ['mom_63'], obs: [['2020-01-10', 1.0, 5.0]], first: '', last: '' });
    // BBB отсутствует в кэше
    const panel = assembleUniverse(['AAA', 'BBB'], 21, cacheMap, ['mom_63']);
    expect(panel.symbols).toEqual(['AAA']);
    expect(panel.rows.length).toBe(1);
    expect(panel.rows[0][0]).toBe(0);
  });
});
