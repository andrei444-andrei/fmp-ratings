import { describe, it, expect } from 'vitest';
import { matchRow, screenByTicker, screenByYear, screenDeals, colIndex, totalConds, type ScreenPanel, type Block } from './screen';

// Панель: 2 тикера × 5 лет × 4 наблюдения, cols mom_63, vol_21. Детерминированно.
function makePanel(): ScreenPanel {
  const symbols = ['AAA', 'BBB'];
  const cols = ['mom_63', 'vol_21'];
  const dates: string[] = [];
  for (let y = 2020; y <= 2024; y++) for (let k = 0; k < 4; k++) dates.push(`${y}-0${k + 1}-10`);
  const rows: (number | null)[][] = [];
  let s = 99;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let si = 0; si < 2; si++) for (let di = 0; di < dates.length; di++) {
    const mom = Math.round((rnd() - 0.45) * 50 * 10) / 10;
    const vol = Math.round((10 + rnd() * 40) * 10) / 10;
    const fwd = Math.round((rnd() - 0.45) * 8 * 10) / 10;
    rows.push([si, di, fwd, mom, vol]);
  }
  return { symbols, dates, cols, rows };
}

const P = makePanel();
const ci = colIndex(P);
// эталонный матч в лоб
function refMatch(row: (number | null)[], blocks: Block[]): boolean {
  const active = blocks.filter((b) => b.conds.length);
  if (!active.length) return true;
  return active.some((b) => b.conds.every((c) => {
    const v = row[3 + P.cols.indexOf(c.col)] as number;
    if (v == null) return false;
    const ok = c.cmp === 'ge' ? v >= c.val : v <= c.val;
    return c.not ? !ok : ok;
  }));
}

describe('screen — конструктор условий', () => {
  it('один блок И: оба условия должны выполняться', () => {
    const blocks: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: 0 }, { col: 'vol_21', cmp: 'le', val: 30 }] }];
    P.rows.forEach((r) => expect(matchRow(r, blocks, ci)).toBe(refMatch(r, blocks)));
    const cnt = P.rows.filter((r) => matchRow(r, blocks, ci)).length;
    expect(cnt).toBeGreaterThan(0);
  });

  it('НЕ инвертирует условие', () => {
    const a: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: 0 }] }];
    const b: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: 0, not: true }] }];
    P.rows.forEach((r) => expect(matchRow(r, a, ci)).toBe(!matchRow(r, b, ci) || (r[3] == null)));
  });

  it('два блока = ИЛИ (объединение)', () => {
    const b1: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: 15 }] }];
    const b2: Block[] = [{ conds: [{ col: 'vol_21', cmp: 'le', val: 15 }] }];
    const both: Block[] = [b1[0], b2[0]];
    P.rows.forEach((r) => expect(matchRow(r, both, ci)).toBe(matchRow(r, b1, ci) || matchRow(r, b2, ci)));
  });

  it('нет условий → все сделки проходят', () => {
    expect(totalConds([{ conds: [] }])).toBe(0);
    expect(P.rows.every((r) => matchRow(r, [{ conds: [] }], ci))).toBe(true);
  });

  it('по тикерам: агрегаты сходятся с эталоном, сорт по ср. форварду', () => {
    const blocks: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: -5 }] }];
    const got = screenByTicker(P, blocks, ['vol_21']);
    // эталон по AAA
    const ref = P.rows.filter((r) => r[0] === 0 && refMatch(r, blocks));
    const aaa = got.find((g) => g.symbol === 'AAA')!;
    expect(aaa.n).toBe(ref.length);
    expect(aaa.avgFwd).toBeCloseTo(ref.reduce((a, r) => a + (r[2] as number), 0) / ref.length, 9);
    expect(got[0].avgFwd).toBeGreaterThanOrEqual(got[got.length - 1].avgFwd); // сортировка по убыв.
  });

  it('по годам: сумма наблюдений = числу матч-сделок', () => {
    const blocks: Block[] = [{ conds: [{ col: 'vol_21', cmp: 'le', val: 35 }] }];
    const yrs = screenByYear(P, blocks);
    const total = yrs.reduce((a, y) => a + y.n, 0);
    expect(total).toBe(P.rows.filter((r) => matchRow(r, blocks, ci)).length);
    expect(yrs.map((y) => y.year)).toEqual([...yrs.map((y) => y.year)].sort((a, b) => a - b));
  });

  it('провал в сделки: по тикеру возвращает только его матч-сделки с метриками', () => {
    const blocks: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: 0 }] }];
    const deals = screenDeals(P, blocks, 't', 'BBB');
    expect(deals.every((d) => d.symbol === 'BBB')).toBe(true);
    expect(deals.every((d) => d.vals.mom_63 != null && (d.vals.mom_63 as number) >= 0)).toBe(true);
    // отсортировано по дате
    for (let i = 1; i < deals.length; i++) expect(deals[i].date >= deals[i - 1].date).toBe(true);
  });
});
