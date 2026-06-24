import { describe, it, expect } from 'vitest';
import { reconstructBets, type Trade, type MarketMeta } from './walletData';

function meta(over: Partial<MarketMeta> = {}): MarketMeta {
  return { conditionId: 'c', question: 'q', category: 'macro', horizonDays: 30, closed: true, winningIndex: 0, endDate: null, ...over };
}

describe('reconstructBets', () => {
  it('держал победивший исход → win=1, edge = 1 − средняя цена входа', () => {
    const trades: Trade[] = [
      { conditionId: 'A', outcomeIndex: 0, side: 'BUY', size: 100, usdc: 60 }, // вход 0.6
    ];
    const m = new Map<string, MarketMeta>([['A', meta({ conditionId: 'A', winningIndex: 0 })]]);
    const bets = reconstructBets(trades, m);
    expect(bets).toHaveLength(1);
    expect(bets[0].win).toBe(1);
    expect(bets[0].entry).toBeCloseTo(0.6, 5);
    expect(bets[0].pnl).toBeCloseTo(100 - 60, 5); // редемпшн 100 − вложено 60
    expect(bets[0].cost).toBeCloseTo(60, 5);
  });

  it('держал проигравший исход → win=0, отрицательный PnL', () => {
    const trades: Trade[] = [{ conditionId: 'A', outcomeIndex: 1, side: 'BUY', size: 100, usdc: 40 }];
    const m = new Map<string, MarketMeta>([['A', meta({ conditionId: 'A', winningIndex: 0 })]]);
    const bets = reconstructBets(trades, m);
    expect(bets[0].win).toBe(0);
    expect(bets[0].pnl).toBeCloseTo(-40, 5);
  });

  it('частичная продажа учитывается в PnL', () => {
    const trades: Trade[] = [
      { conditionId: 'A', outcomeIndex: 0, side: 'BUY', size: 100, usdc: 50 },  // вход 0.5
      { conditionId: 'A', outcomeIndex: 0, side: 'SELL', size: 40, usdc: 36 },   // продал 40 по 0.9
    ];
    const m = new Map<string, MarketMeta>([['A', meta({ conditionId: 'A', winningIndex: 0 })]]);
    const bets = reconstructBets(trades, m);
    // net 60 шар победили → редемпшн 60; PnL = 36 (sell) + 60 (redeem) − 50 (buy) = 46
    expect(bets[0].win).toBe(1);
    expect(bets[0].pnl).toBeCloseTo(46, 5);
  });

  it('полностью вышел до разрешения → не считаем как пари', () => {
    const trades: Trade[] = [
      { conditionId: 'A', outcomeIndex: 0, side: 'BUY', size: 100, usdc: 50 },
      { conditionId: 'A', outcomeIndex: 0, side: 'SELL', size: 100, usdc: 70 },
    ];
    const m = new Map<string, MarketMeta>([['A', meta({ conditionId: 'A', winningIndex: 0 })]]);
    expect(reconstructBets(trades, m)).toHaveLength(0);
  });

  it('неразрешённый рынок пропускается', () => {
    const trades: Trade[] = [{ conditionId: 'A', outcomeIndex: 0, side: 'BUY', size: 100, usdc: 50 }];
    const m = new Map<string, MarketMeta>([['A', meta({ conditionId: 'A', closed: false, winningIndex: null })]]);
    expect(reconstructBets(trades, m)).toHaveLength(0);
  });

  it('горизонт прокидывается из метаданных', () => {
    const trades: Trade[] = [{ conditionId: 'A', outcomeIndex: 0, side: 'BUY', size: 10, usdc: 5 }];
    const m = new Map<string, MarketMeta>([['A', meta({ conditionId: 'A', horizonDays: 3 })]]);
    expect(reconstructBets(trades, m)[0].horizonDays).toBe(3);
  });
});
