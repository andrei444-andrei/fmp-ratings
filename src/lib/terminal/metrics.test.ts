import { describe, it, expect } from 'vitest';
import {
  pctReturnOverWindow,
  annualizedVol,
  zScoreOfDailyReturn,
  pct52wRange,
  sma,
  calendarReturn,
  downsample,
  correlation,
  computeInstrumentMetrics,
  startOfQuarterISO,
  type Bar,
} from './metrics';
import { SEED_BLOCKS, SEED_INSTRUMENTS, instrumentDef, allSymbols } from './registry';

// Хелпер: ряд цен в бары с фиктивными последовательными датами.
function bars(closes: number[], startISO = '2024-01-01'): Bar[] {
  const d = new Date(startISO + 'T00:00:00Z');
  return closes.map((c) => {
    const date = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date, close: c };
  });
}

describe('pctReturnOverWindow', () => {
  it('доходность за N торговых дней по индексам', () => {
    expect(pctReturnOverWindow([100, 110], 1)).toBeCloseTo(10, 6);
    expect(pctReturnOverWindow([100, 105, 110, 121], 3)).toBeCloseTo(21, 6);
  });
  it('null когда истории не хватает или делитель нулевой', () => {
    expect(pctReturnOverWindow([100], 1)).toBeNull();
    expect(pctReturnOverWindow([100, 110], 5)).toBeNull();
    expect(pctReturnOverWindow([0, 110], 1)).toBeNull();
  });
});

describe('annualizedVol', () => {
  it('постоянный темп роста → почти нулевая волатильность', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 * 1.01 ** i);
    const v = annualizedVol(closes, 21);
    expect(v).not.toBeNull();
    expect(v as number).toBeLessThan(1e-6);
  });
  it('null при недостатке истории', () => {
    expect(annualizedVol([100, 101, 102], 21)).toBeNull();
  });
});

describe('zScoreOfDailyReturn', () => {
  it('нулевая дисперсия истории → null', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 * 1.01 ** i);
    expect(zScoreOfDailyReturn(closes, 63)).toBeNull();
  });
  it('одиночный скачок в конце даёт большой положительный z', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.01); // почти плоско
    closes[closes.length - 1] = closes[closes.length - 2] * 1.1; // +10% шок
    const z = zScoreOfDailyReturn(closes, 63);
    expect(z).not.toBeNull();
    expect(z as number).toBeGreaterThan(3);
  });
});

describe('pct52wRange', () => {
  it('последняя на максимуме → 100, на минимуме → 0', () => {
    const up = Array.from({ length: 252 }, (_, i) => 100 + i);
    expect(pct52wRange(up)).toBeCloseTo(100, 6);
    const down = Array.from({ length: 252 }, (_, i) => 100 - i);
    expect(pct52wRange(down)).toBeCloseTo(0, 6);
  });
});

describe('sma', () => {
  it('среднее последних N', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBeCloseTo(3, 6);
    expect(sma([1, 2], 5)).toBeNull();
  });
});

describe('calendarReturn (MTD/QTD/YTD)', () => {
  it('от первого бара на/после границы до последнего', () => {
    const series = bars([100, 101, 102, 103], '2024-12-30'); // 12-30,12-31,01-01,01-02
    // YTD от 2025-01-01 (индекс 2, close 102) до 103 = ~0.98%
    expect(calendarReturn(series, '2025-01-01')).toBeCloseTo(((103 - 102) / 102) * 100, 6);
  });
  it('startOfQuarter правильно округляет месяц', () => {
    expect(startOfQuarterISO('2024-05-17')).toBe('2024-04-01');
    expect(startOfQuarterISO('2024-11-30')).toBe('2024-10-01');
  });
});

describe('downsample', () => {
  it('сохраняет границы и не превышает target', () => {
    const closes = Array.from({ length: 500 }, (_, i) => i);
    const ds = downsample(closes, 80);
    expect(ds.length).toBe(80);
    expect(ds[0]).toBe(0);
    expect(ds[ds.length - 1]).toBe(499);
  });
  it('короткий ряд возвращается как есть', () => {
    expect(downsample([1, 2, 3], 80)).toEqual([1, 2, 3]);
  });
});

describe('correlation', () => {
  it('идентичные ряды → 1, противоположные → -1', () => {
    const a = [0.01, -0.02, 0.03, -0.01, 0.02];
    expect(correlation(a, a) as number).toBeCloseTo(1, 6);
    expect(correlation(a, a.map((x) => -x)) as number).toBeCloseTo(-1, 6);
  });
});

describe('computeInstrumentMetrics', () => {
  it('graceful на пустом/коротком ряде', () => {
    expect(computeInstrumentMetrics([])).toBeNull();
    expect(computeInstrumentMetrics(bars([100]))).toBeNull();
  });
  it('полный ряд: возвращает доходности по всем окнам и last/asOf', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 * 1.001 ** i);
    const series = bars(closes);
    const m = computeInstrumentMetrics(series)!;
    expect(m).not.toBeNull();
    expect(m.last).toBeCloseTo(closes[closes.length - 1], 6);
    expect(m.returns[1]).not.toBeNull();
    expect(m.returns[252]).not.toBeNull();
    expect(m.spark.length).toBeLessThanOrEqual(80);
    expect(m.aboveMA200).toBe(true); // монотонный рост
  });
});

describe('реестр вселенной', () => {
  it('FX-инвариант: все члены блока стран — USD', () => {
    const countries = SEED_BLOCKS.find((b) => b.id === 'countries')!;
    for (const sym of countries.members) {
      const def = instrumentDef(sym);
      expect(def, `нет определения для ${sym}`).toBeTruthy();
      expect(def!.currency, `${sym} должен быть USD`).toBe('USD');
    }
  });
  it('все члены и бенчмарки блоков определены в реестре инструментов', () => {
    for (const b of SEED_BLOCKS) {
      for (const sym of b.members) expect(instrumentDef(sym), `${b.id}/${sym}`).toBeTruthy();
      if (b.benchmark) expect(instrumentDef(b.benchmark), `bench ${b.benchmark}`).toBeTruthy();
    }
  });
  it('allSymbols уникален и включает бенчмарки', () => {
    const syms = allSymbols();
    expect(new Set(syms).size).toBe(syms.length);
    expect(syms).toContain('ACWI'); // бенчмарк блока стран
    expect(syms.length).toBeLessThanOrEqual(SEED_INSTRUMENTS.length);
  });
});
