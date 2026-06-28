import { describe, it, expect } from 'vitest';
import { compileFormula } from './formula';

const G = (m: Record<string, number | null>) => (n: string) => (n in m ? m[n] : null);

describe('formula — безопасный вычислитель', () => {
  it('арифметика и приоритет операций', () => {
    expect(compileFormula('1 + 2 * 3').eval(G({}))).toBe(7);
    expect(compileFormula('(1 + 2) * 3').eval(G({}))).toBe(9);
    expect(compileFormula('-5 + 2').eval(G({}))).toBe(-3);
    expect(compileFormula('10 / 4').eval(G({}))).toBe(2.5);
  });

  it('ссылки на колонки (подчёркивание и скобки)', () => {
    const c = compileFormula('(momentum_21 + momentum_63 + momentum_126) / 3');
    expect(c.refs.sort()).toEqual(['momentum_126', 'momentum_21', 'momentum_63']);
    expect(c.eval(G({ momentum_21: 9, momentum_63: 12, momentum_126: 15 }))).toBe(12);
  });

  it('параметрический синтаксис factor[период]', () => {
    const c = compileFormula('avg(momentum[21], momentum[63], momentum[126])');
    expect(c.refs.sort()).toEqual(['momentum_126', 'momentum_21', 'momentum_63']);
    expect(c.eval(G({ momentum_21: 9, momentum_63: 12, momentum_126: 15 }))).toBe(12);
    expect(compileFormula('xbench[5] - xbench[252]').eval(G({ xbench_5: 3, xbench_252: 1 }))).toBe(2);
    expect(() => compileFormula('momentum[]')).toThrow(/период/);
    expect(() => compileFormula('momentum[5')).toThrow(/скобка/);
  });

  it('функции avg/min/max/sum/abs', () => {
    expect(compileFormula('avg(momentum_21, momentum_63, momentum_126)').eval(G({ momentum_21: 9, momentum_63: 12, momentum_126: 15 }))).toBe(12);
    expect(compileFormula('min(vol_21, vol_63)').eval(G({ vol_21: 18, vol_63: 22 }))).toBe(18);
    expect(compileFormula('max(vol_21, vol_63)').eval(G({ vol_21: 18, vol_63: 22 }))).toBe(22);
    expect(compileFormula('sum(a, b, c)').eval(G({ a: 1, b: 2, c: 3 }))).toBe(6);
    expect(compileFormula('abs(xbench_21)').eval(G({ xbench_21: -7 }))).toBe(7);
  });

  it('нелинейные функции sqrt/log/pow/sign + домен-ошибки → null', () => {
    expect(compileFormula('sqrt(vol_21)').eval(G({ vol_21: 16 }))).toBe(4);
    expect(compileFormula('pow(momentum_21, 2)').eval(G({ momentum_21: 3 }))).toBe(9);
    expect(compileFormula('sign(xbench_21)').eval(G({ xbench_21: -7 }))).toBe(-1);
    expect(compileFormula('log(vol_21)').eval(G({ vol_21: 1 }))).toBe(0);
    expect(compileFormula('sqrt(momentum_21)').eval(G({ momentum_21: -4 }))).toBeNull(); // домен
    expect(compileFormula('log(momentum_21)').eval(G({ momentum_21: 0 }))).toBeNull();
    expect(() => compileFormula('pow(1)')).toThrow(/pow/);
    expect(() => compileFormula('sqrt(1, 2)')).toThrow(/sqrt/);
  });

  it('null-семантика: неопределённый фактор → null; деление на 0 → null', () => {
    expect(compileFormula('momentum_21 + momentum_63').eval(G({ momentum_21: 5, momentum_63: null }))).toBeNull();
    expect(compileFormula('avg(a, b)').eval(G({ a: 5, b: null }))).toBeNull();
    expect(compileFormula('a / b').eval(G({ a: 5, b: 0 }))).toBeNull();
    expect(compileFormula('missing').eval(G({}))).toBeNull();
  });

  it('ошибки парсинга', () => {
    expect(() => compileFormula('')).toThrow();
    expect(() => compileFormula('1 + ')).toThrow();
    expect(() => compileFormula('(1 + 2')).toThrow();
    expect(() => compileFormula('foo(1)')).toThrow(/Неизвестная функция/);
    expect(() => compileFormula('1 2')).toThrow(/Лишние/);
    expect(() => compileFormula('abs(1, 2)')).toThrow(/abs/);
  });
});
