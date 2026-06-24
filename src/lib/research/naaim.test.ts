import { describe, it, expect } from 'vitest';
import { syntheticNaaim } from './naaim';

// Синтетика NAAIM — фолбэк для офлайна/e2e (конституция §6). Должна быть детерминированной
// (CI-воспроизводимость) и реалистичной по форме недельного индикатора.
describe('syntheticNaaim', () => {
  it('детерминирована: два вызова дают идентичные значения по индексам', () => {
    const a = syntheticNaaim();
    const b = syntheticNaaim();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].date).toBe(b[i].date);
      expect(a[i].value).toBe(b[i].value);
    }
  });

  it('недельная сетка с 2006, даты строго возрастают, шаг 7 дней', () => {
    const rows = syntheticNaaim();
    expect(rows.length).toBeGreaterThan(900); // ~2006→сейчас ≈ 1000+ недель
    expect(rows[0].date).toBe('2006-01-04');
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].date > rows[i - 1].date).toBe(true);
      const gap = (Date.parse(rows[i].date) - Date.parse(rows[i - 1].date)) / 864e5;
      expect(gap).toBe(7);
    }
  });

  it('значения в реалистичном диапазоне и не константа', () => {
    const vals = syntheticNaaim().map((r) => r.value);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(-40);
    expect(Math.max(...vals)).toBeLessThanOrEqual(150);
    expect(new Set(vals).size).toBeGreaterThan(50); // явно варьируется
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(mean).toBeGreaterThan(30);
    expect(mean).toBeLessThan(90); // возврат к среднему ~60
  });
});
