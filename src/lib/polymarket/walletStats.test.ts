import { describe, it, expect } from 'vitest';
import { edgeStats, statsByCategory, type ResolvedBet } from './walletStats';
import type { CatKey } from './classify';

function bet(win: 0 | 1, entry: number, cat: CatKey | null = 'macro', horizonDays = 30): ResolvedBet {
  return { conditionId: Math.random().toString(36), category: cat, horizonDays, win, entry, pnl: win ? (1 - entry) * 100 : -entry * 100, cost: entry * 100 };
}

function many(n: number, win: 0 | 1, entry: number, cat: CatKey | null = 'macro') {
  return Array.from({ length: n }, () => bet(win, entry, cat));
}

describe('edgeStats', () => {
  it('скилловый кошелёк (положительный edge, n≥20) — значим', () => {
    const bets = [...many(20, 1, 0.5), ...many(5, 0, 0.5)]; // edge +0.5 ×20, −0.5 ×5
    const s = edgeStats(bets, 20);
    expect(s.meanEdge).toBeCloseTo(0.3, 5);
    expect(s.significant).toBe(true);
    expect(s.winRate).toBeCloseTo(20 / 25, 5);
  });

  it('подбрасывание монеты — не значим (edge≈0)', () => {
    const bets = [...many(15, 1, 0.5), ...many(15, 0, 0.5)];
    const s = edgeStats(bets, 20);
    expect(s.meanEdge).toBeCloseTo(0, 5);
    expect(s.significant).toBe(false);
  });

  it('проигрывающий кошелёк — не значим (edge<0)', () => {
    const s = edgeStats(many(30, 0, 0.5), 20);
    expect(s.meanEdge).toBeLessThan(0);
    expect(s.significant).toBe(false);
  });

  it('мало наблюдений — не значим даже при сильном edge', () => {
    const s = edgeStats(many(10, 1, 0.4), 20); // edge +0.6, но n<20
    expect(s.meanEdge).toBeGreaterThan(0);
    expect(s.significant).toBe(false);
  });

  it('ставки на фаворитов с нулевым edge — не значимы', () => {
    // покупает по 0.5 ровно столько же, сколько проигрывает по тем же шансам
    const s = edgeStats([...many(13, 1, 0.5), ...many(13, 0, 0.5)], 20);
    expect(Math.abs(s.meanEdge)).toBeLessThan(1e-9);
    expect(s.significant).toBe(false);
  });

  it('99%-фаворит: даже 100/100 выигрышей НЕ значимы (учёт шансов)', () => {
    const s = edgeStats(many(100, 1, 0.99), 20);
    expect(s.winRate).toBe(1);          // винрейт 100%
    expect(s.significant).toBe(false);  // но это не скилл — z мал
  });

  it('60/40-угадайщик на 50/50-рынках — значим', () => {
    const s = edgeStats([...many(60, 1, 0.5), ...many(40, 0, 0.5)], 20);
    expect(s.winRate).toBeCloseTo(0.6, 5);
    expect(s.significant).toBe(true);   // z=2.0, p<0.05
  });

  it('фаворит-беттор слабее реального угадайщика по z при равном винрейте', () => {
    const fav = edgeStats(many(100, 1, 0.9), 20);            // 100% на 0.9
    const skill = edgeStats([...many(70, 1, 0.5), ...many(30, 0, 0.5)], 20); // 70% на 0.5
    expect(skill.tStat).toBeGreaterThan(fav.tStat);
  });

  it('пустой ввод безопасен', () => {
    const s = edgeStats([], 20);
    expect(s.n).toBe(0);
    expect(s.significant).toBe(false);
    expect(s.roi).toBe(0);
  });

  it('ROI и totalPnl считаются', () => {
    const s = edgeStats(many(10, 1, 0.5), 1); // каждый: pnl +50, cost 50 → ROI 1.0
    expect(s.totalPnl).toBeCloseTo(500, 5);
    expect(s.roi).toBeCloseTo(1.0, 5);
  });
});

describe('statsByCategory', () => {
  it('разбивает по категориям независимо', () => {
    const bets = [
      ...many(20, 1, 0.5, 'macro'), ...many(5, 0, 0.5, 'macro'), // macro: значим
      ...many(15, 0, 0.5, 'crypto'),                              // crypto: проигрыш
    ];
    const by = statsByCategory(bets, 20);
    expect(by.macro.significant).toBe(true);
    expect(by.crypto.significant).toBe(false);
    expect(by.macro.n).toBe(25);
    expect(by.crypto.n).toBe(15);
  });
});
