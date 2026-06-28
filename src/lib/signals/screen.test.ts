import { describe, it, expect } from 'vitest';
import { matchRow, screenByTicker, screenByYear, screenDeals, screenAllDeals, dealStats, colIndex, totalConds, OUTN, type ScreenPanel, type Block, type Formulas } from './screen';
import { compileFormula } from './formula';

// Панель: 2 тикера × 5 лет × 4 наблюдения, cols mom_63, vol_21. Детерминированно.
// Строка: [si, di, ret, exc, mfe, mae, mdd, mom, vol] — OUTN исходов, затем факторы (смещение 2+OUTN).
const FAC = 2 + OUTN; // 7
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
    const ret = Math.round((rnd() - 0.45) * 8 * 10) / 10;
    const exc = Math.round(ret * 0.8 * 10) / 10;
    const mfe = Math.abs(ret) + 2;
    const mae = -(Math.abs(ret) + 1);
    const mdd = mae;
    rows.push([si, di, ret, exc, mfe, mae, mdd, mom, vol]);
  }
  return { symbols, dates, cols, rows };
}

const P = makePanel();
const ci = colIndex(P);
// эталонный матч в лоб (факторы со смещения FAC)
function refMatch(row: (number | null)[], blocks: Block[]): boolean {
  const active = blocks.filter((b) => b.conds.length);
  if (!active.length) return true;
  return active.some((b) => b.conds.every((c) => {
    const v = row[FAC + P.cols.indexOf(c.col)] as number;
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
    P.rows.forEach((r) => expect(matchRow(r, a, ci)).toBe(!matchRow(r, b, ci) || (r[FAC] == null)));
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

  it('по тикерам: агрегаты сходятся с эталоном, сорт по ср. return', () => {
    const blocks: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: -5 }] }];
    const got = screenByTicker(P, blocks, ['vol_21']);
    // эталон по AAA
    const ref = P.rows.filter((r) => r[0] === 0 && refMatch(r, blocks));
    const aaa = got.find((g) => g.symbol === 'AAA')!;
    expect(aaa.n).toBe(ref.length);
    expect(aaa.avgRet).toBeCloseTo(ref.reduce((a, r) => a + (r[2] as number), 0) / ref.length, 9);
    // hit-rate = доля ret>0
    expect(aaa.hitPct).toBeCloseTo((ref.filter((r) => (r[2] as number) > 0).length / ref.length) * 100, 9);
    expect(got[0].avgRet).toBeGreaterThanOrEqual(got[got.length - 1].avgRet); // сортировка по убыв.
  });

  it('медиана return корректна', () => {
    const got = screenByTicker(P, [{ conds: [] }], []);
    const aaa = got.find((g) => g.symbol === 'AAA')!;
    const rets = P.rows.filter((r) => r[0] === 0).map((r) => r[2] as number).sort((a, b) => a - b);
    const med = rets.length % 2 ? rets[rets.length >> 1] : (rets[(rets.length >> 1) - 1] + rets[rets.length >> 1]) / 2;
    expect(aaa.medRet).toBeCloseTo(med, 9);
  });

  it('окно лет (minYear) отсекает ранние наблюдения', () => {
    const all = screenByYear(P, [{ conds: [] }]);
    const win = screenByYear(P, [{ conds: [] }], 2023);
    expect(win.every((y) => y.year >= 2023)).toBe(true);
    expect(win.reduce((a, y) => a + y.n, 0)).toBeLessThan(all.reduce((a, y) => a + y.n, 0));
  });

  it('по годам: сумма наблюдений = числу матч-сделок', () => {
    const blocks: Block[] = [{ conds: [{ col: 'vol_21', cmp: 'le', val: 35 }] }];
    const yrs = screenByYear(P, blocks);
    const total = yrs.reduce((a, y) => a + y.n, 0);
    expect(total).toBe(P.rows.filter((r) => matchRow(r, blocks, ci)).length);
    expect(yrs.map((y) => y.year)).toEqual([...yrs.map((y) => y.year)].sort((a, b) => a - b));
  });

  it('формулы: условие и столбец считаются по выражению над факторами', () => {
    const fmap: Formulas = new Map([['fsum', compileFormula('mom_63 + vol_21').eval]]);
    // эталон: сумма фактора момент(7) и волы(8) по строке
    const ref = (r: (number | null)[]) => (r[FAC] as number) + (r[FAC + 1] as number);
    const blocks: Block[] = [{ conds: [{ col: 'fsum', cmp: 'ge', val: 20 }] }];
    P.rows.forEach((r) => expect(matchRow(r, blocks, ci, fmap)).toBe(ref(r) >= 20));
    // столбец-формула: среднее значение fsum по тикеру AAA сходится с эталоном
    const got = screenByTicker(P, [{ conds: [] }], ['fsum'], undefined, fmap);
    const aaa = got.find((g) => g.symbol === 'AAA')!;
    const refRows = P.rows.filter((r) => r[0] === 0);
    expect(aaa.disp[0]).toBeCloseTo(refRows.reduce((a, r) => a + ref(r), 0) / refRows.length, 9);
  });

  it('сводно: все матч-сделки = сумме по годам; сводная статистика согласована', () => {
    const blocks: Block[] = [{ conds: [{ col: 'vol_21', cmp: 'le', val: 35 }] }];
    const all = screenAllDeals(P, blocks);
    const yrs = screenByYear(P, blocks);
    expect(all.length).toBe(yrs.reduce((a, y) => a + y.n, 0));
    const st = dealStats(all);
    expect(st.n).toBe(all.length);
    expect(st.tickers).toBe(new Set(all.map((d) => d.symbol)).size);
    expect(st.avgRet).toBeCloseTo(all.reduce((a, d) => a + d.ret, 0) / all.length, 9);
    // окно лет отсекает и в своде
    expect(screenAllDeals(P, blocks, 2023).every((d) => +d.date.slice(0, 4) >= 2023)).toBe(true);
  });

  it('провал в сделки: по тикеру возвращает только его матч-сделки с метриками и исходами', () => {
    const blocks: Block[] = [{ conds: [{ col: 'mom_63', cmp: 'ge', val: 0 }] }];
    const deals = screenDeals(P, blocks, 't', 'BBB');
    expect(deals.every((d) => d.symbol === 'BBB')).toBe(true);
    expect(deals.every((d) => d.vals.mom_63 != null && (d.vals.mom_63 as number) >= 0)).toBe(true);
    expect(deals.every((d) => Number.isFinite(d.ret) && Number.isFinite(d.mfe) && Number.isFinite(d.mdd))).toBe(true);
    // отсортировано по дате
    for (let i = 1; i < deals.length; i++) expect(deals[i].date >= deals[i - 1].date).toBe(true);
    // сводка согласована
    const st = dealStats(deals);
    expect(st.n).toBe(deals.length);
    expect(st.avgRet).toBeCloseTo(deals.reduce((a, d) => a + d.ret, 0) / deals.length, 9);
  });
});
