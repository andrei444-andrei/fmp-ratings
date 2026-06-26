import { describe, it, expect } from 'vitest';
import { assembleUniverse, splitEngineResult, type TickerPanel } from './screenAssemble';
import { OUTN } from './screen';

// Результат движка screen: rows = [symIdx, dateIdx, ret, exc, mfe, mae, mdd, v0, v1] (OUTN исходов, затем факторы).
const ENG = {
  symbols: ['AAA', 'BBB'],
  dates: ['2020-01-10', '2020-06-10', '2021-01-10'],
  cols: ['mom_63', 'vol_21'],
  rows: [
    [0, 0, 1.2, 0.9, 4.0, -2.0, -2.5, 5.0, 12.0],
    [0, 2, -0.5, -0.6, 1.5, -3.0, -3.2, -3.0, 18.0],
    [1, 1, 2.1, 1.7, 6.0, -1.0, -1.4, 9.0, 10.0],
    [1, 2, 0.3, 0.2, 2.2, -0.8, -1.0, 1.0, 14.0],
  ] as (number | null)[][],
};
const FAC = 2 + OUTN; // 7 — индекс первого фактора в строке движка

describe('screenAssemble', () => {
  it('split: разбивает результат движка на per-ticker наблюдения с исходами, отсортированные по дате', () => {
    const { cols, perTicker } = splitEngineResult(ENG);
    expect(cols).toEqual(['mom_63', 'vol_21']);
    expect(perTicker.get('AAA')!.length).toBe(2);
    expect(perTicker.get('BBB')!.length).toBe(2);
    // AAA: [date, ret, exc, mfe, mae, mdd, mom, vol]
    expect(perTicker.get('AAA')![0]).toEqual(['2020-01-10', 1.2, 0.9, 4.0, -2.0, -2.5, 5.0, 12.0]);
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
    expect(panel.dates).toEqual(['2020-01-10', '2020-06-10', '2021-01-10']);
    // каждая строка: [symIdx, dateIdx, ret, exc, mfe, mae, mdd, mom, vol] — исходы и факторы сохранены
    for (const r of panel.rows) {
      const sym = panel.symbols[r[0] as number];
      const date = panel.dates[r[1] as number];
      const ref = ENG.rows.find((er) => ENG.symbols[er[0] as number] === sym && ENG.dates[er[1] as number] === date)!;
      expect(r[2]).toBe(ref[2]);     // ret
      expect(r[6]).toBe(ref[6]);     // mdd
      expect(r[FAC]).toBe(ref[FAC]); // mom (первый фактор)
    }
  });

  it('assemble: пропускает тикеры без данных, индексы согласованы', () => {
    const cacheMap = new Map<string, TickerPanel>();
    cacheMap.set('AAA', { cols: ['mom_63'], obs: [['2020-01-10', 1.0, 0.8, 3.0, -1.0, -1.2, 5.0]], first: '', last: '' });
    // BBB отсутствует в кэше
    const panel = assembleUniverse(['AAA', 'BBB'], 21, cacheMap, ['mom_63']);
    expect(panel.symbols).toEqual(['AAA']);
    expect(panel.rows.length).toBe(1);
    expect(panel.rows[0][0]).toBe(0);
    expect(panel.rows[0][2]).toBe(1.0);                // ret
    expect(panel.rows[0][2 + OUTN]).toBe(5.0);          // первый фактор
  });
});
