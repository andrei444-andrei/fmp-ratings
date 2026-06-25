import { describe, it, expect } from 'vitest';
import { summarizeBreadth } from './breadth';

const data = [
  { ym: '2020-01', n: 0, top1: 0 },     // кэш
  { ym: '2020-02', n: 1, top1: 1.0 },   // одна позиция, полный перекос
  { ym: '2020-03', n: 3, top1: 0.4 },
  { ym: '2021-01', n: 2, top1: 0.6 },
  { ym: '2021-02', n: 1, top1: 0.95 },
];

describe('summarizeBreadth', () => {
  it('avgN/pctSingle/pctCash/maxTop1 — по месяцам в рынке', () => {
    const s = summarizeBreadth(data);
    expect(s.months).toBe(5);
    expect(s.inMarket).toBe(4);
    expect(s.pctCash).toBeCloseTo(1 / 5, 9);
    expect(s.avgN).toBeCloseTo((1 + 3 + 2 + 1) / 4, 9); // 1.75
    expect(s.pctSingle).toBeCloseTo(2 / 4, 9);          // 2 из 4 in-market — одна позиция
    expect(s.maxTop1).toBeCloseTo(1.0, 9);
  });

  it('распределение по числу позиций (кэш/1/2/3)', () => {
    const s = summarizeBreadth(data);
    const m = Object.fromEntries(s.dist.map(d => [d.k, d.count]));
    expect(m['кэш']).toBe(1);
    expect(m['1']).toBe(2);
    expect(m['2']).toBe(1);
    expect(m['3']).toBe(1);
    expect(s.dist.reduce((x, d) => x + d.count, 0)).toBe(5); // покрывают все месяцы
  });

  it('5+ позиций схлопывается в один бакет', () => {
    const s = summarizeBreadth([{ ym: '2020-01', n: 7, top1: 0.2 }, { ym: '2020-02', n: 5, top1: 0.3 }]);
    expect(s.dist.find(d => d.k === '5+')!.count).toBe(2);
  });

  it('разбивка по годам', () => {
    const s = summarizeBreadth(data);
    const y2020 = s.perYear.find(y => y.year === 2020)!;
    expect(y2020.months).toBe(3);
    expect(y2020.avgN).toBeCloseTo((1 + 3) / 2, 9); // in-market 2 месяца
    expect(y2020.pctSingle).toBeCloseTo(1 / 2, 9);
    expect(y2020.maxTop1).toBeCloseTo(1.0, 9);
  });

  it('пустой вход → нули, без падения', () => {
    const s = summarizeBreadth([]);
    expect(s.months).toBe(0);
    expect(s.avgN).toBe(0);
    expect(s.dist).toEqual([]);
    expect(s.perYear).toEqual([]);
  });
});
