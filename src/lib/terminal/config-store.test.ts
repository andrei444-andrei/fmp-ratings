import { describe, it, expect } from 'vitest';
import { normalizeConfig, DEFAULT_CONFIG } from './config-store';
import { applyBlockOverrides, SEED_BLOCKS } from './registry';

describe('normalizeConfig', () => {
  it('подставляет дефолты для пустого/мусорного ввода', () => {
    const c = normalizeConfig({});
    expect(c.compare.symbols).toEqual(DEFAULT_CONFIG.compare.symbols);
    expect(c.corr.symbols).toEqual(DEFAULT_CONFIG.corr.symbols);
    expect(c.blocks).toEqual({});
    expect(c.watchlist).toEqual([]);
  });

  it('санитизирует watchlist: апперкейс, дедуп, отсев мусора (пробелы/длина), кап', () => {
    const c = normalizeConfig({ watchlist: ['spy', 'SPY', 'gld', 'не валидно!', '', 'TOOLONGSYMBOL123'] });
    expect(c.watchlist).toEqual(['SPY', 'GLD']);
  });

  it('санитизирует переопределения блоков и выбрасывает пустые/невалидные', () => {
    const c = normalizeConfig({
      blocks: {
        metals: ['gld', 'slv', 'gld'], // дедуп + апперкейс
        bad__id$: ['AAA'], // невалидный id ($) → отбрасывается
        empty: [], // пустой оверрайд → отбрасывается
        chips: ['nope!', 'NVDA'], // мусорный символ отсеивается
      },
    });
    expect(c.blocks.metals).toEqual(['GLD', 'SLV']);
    expect(c.blocks.chips).toEqual(['NVDA']);
    expect(c.blocks).not.toHaveProperty('bad__id$');
    expect(c.blocks).not.toHaveProperty('empty');
  });
});

describe('applyBlockOverrides', () => {
  it('без оверрайдов возвращает сид как есть', () => {
    expect(applyBlockOverrides(undefined)).toBe(SEED_BLOCKS);
  });

  it('непустой оверрайд заменяет members блока, остальные нетронуты', () => {
    const out = applyBlockOverrides({ metals: ['GLD', 'XYZ'] });
    const metals = out.find((b) => b.id === 'metals')!;
    const countries = out.find((b) => b.id === 'countries')!;
    const seedCountries = SEED_BLOCKS.find((b) => b.id === 'countries')!;
    expect(metals.members).toEqual(['GLD', 'XYZ']);
    expect(metals.benchmark).toBe(SEED_BLOCKS.find((b) => b.id === 'metals')!.benchmark);
    expect(countries.members).toEqual(seedCountries.members); // не тронут
  });

  it('пустой оверрайд игнорируется (возврат к сиду)', () => {
    const out = applyBlockOverrides({ metals: [] });
    const metals = out.find((b) => b.id === 'metals')!;
    expect(metals.members).toEqual(SEED_BLOCKS.find((b) => b.id === 'metals')!.members);
  });
});
