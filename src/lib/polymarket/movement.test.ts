import { describe, it, expect } from 'vitest';
import { computeMovement, windowDelta, type HistPoint } from './movement';

// Почасовой ряд за `days` дней; p задаётся функцией от «часов назад».
function series(days: number, pByHoursAgo: (hoursAgo: number) => number): HistPoint[] {
  const now = 1_700_000_000;
  const n = days * 24;
  const out: HistPoint[] = [];
  for (let i = n; i >= 0; i--) {
    out.push({ t: now - i * 3600, p: pByHoursAgo(i) });
  }
  return out;
}

describe('computeMovement', () => {
  it('детектит разворот: неделя вверх, последние сутки вниз', () => {
    const h = series(8, (ago) => {
      if (ago > 24) {
        // дни 7..1: рост 0.30 → 0.60
        const frac = (192 - ago) / (192 - 24);
        return 0.3 + 0.3 * Math.min(1, Math.max(0, frac));
      }
      // последние сутки: спад 0.60 → 0.55
      return 0.6 - 0.05 * ((24 - ago) / 24);
    });
    const m = computeMovement(h)!;
    expect(m).not.toBeNull();
    expect(m.d24h).toBeLessThan(0);       // последние сутки вниз
    expect(m.d7d).toBeGreaterThan(0);     // за неделю всё ещё вверх
    expect(m.reversal).toBe(true);
    expect(m.direction).toBe(-1);
  });

  it('считает дельты окон по фактическим точкам', () => {
    // линейный рост на 0.01 в день от 0.40
    const h = series(8, (ago) => 0.4 + (192 - ago) / 24 * 0.01);
    const m = computeMovement(h)!;
    expect(m.d24h).toBeCloseTo(0.01, 2);
    expect(m.d7d).toBeCloseTo(0.07, 2);
  });

  it('возвращает null на слишком коротком ряде', () => {
    expect(computeMovement([{ t: 1, p: 0.5 }])).toBeNull();
  });

  it('windowDelta выбирает нужное окно', () => {
    const h = series(8, (ago) => 0.4 + (192 - ago) / 24 * 0.01);
    const m = computeMovement(h)!;
    expect(windowDelta(m, '24h')).toBe(m.d24h);
    expect(windowDelta(m, '7d')).toBe(m.d7d);
  });
});
