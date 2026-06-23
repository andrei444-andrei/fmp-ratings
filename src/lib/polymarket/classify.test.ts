import { describe, it, expect } from 'vitest';
import { categoriesOf } from './classify';

describe('categoriesOf', () => {
  const cases: [string, string][] = [
    ['Fed rate hike in 2026?', 'macro'],
    ['Will the S&P 500 hit a new all-time high?', 'index'],
    ['Will NVIDIA be the largest company in the world by market cap?', 'megacap'],
    ['Will WTI crude oil reach $100?', 'commodity'],
    ['Will Bitcoin hit $150k by June 30?', 'crypto'],
    ['Will Tesla report record deliveries this quarter?', 'equity'],
    ['Will there be a recession in 2026?', 'macro'],
  ];

  it.each(cases)('«%s» → %s', (q, expected) => {
    expect(categoriesOf(q).primary).toBe(expected);
  });

  it('нерелевантный рынок не классифицируется', () => {
    expect(categoriesOf('Will it rain in London tomorrow?').primary).toBeNull();
  });

  it('приоритет: ФРС важнее упоминания акций', () => {
    // есть и «stock market», и «Fed» → primary должен быть macro (выше по приоритету)
    const { primary, cats } = categoriesOf('How will the stock market react to the Fed decision?');
    expect(cats).toContain('macro');
    expect(primary).toBe('macro');
  });
});
