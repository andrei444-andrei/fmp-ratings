import { describe, it, expect } from 'vitest';
import { normalizeConfig, DEFAULT_CONFIG } from './config-store';
import { applyBlockOverrides, effectiveBlocks, SEED_BLOCKS } from './registry';

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

  it('санитизирует customBaskets / hiddenBlocks / blockTitles', () => {
    const c = normalizeConfig({
      customBaskets: [
        { id: 'my_basket', title: '  Моя  корзина  ', members: ['nvda', 'avgo', 'nvda'] }, // тримминг title, дедуп
        { id: 'no_members', title: 'X', members: [] }, // без бумаг → отброшена
        { id: 'bad id', title: 'Y', members: ['AAA'] }, // невалидный id → отброшена
      ],
      hiddenBlocks: ['metals', 'bad id!', 'metals'], // дедуп + отсев мусора
      blockTitles: { countries: '  Страны  мира ', bad$id: 'Z' },
    });
    expect(c.customBaskets).toHaveLength(1);
    expect(c.customBaskets[0]).toEqual({ id: 'my_basket', title: 'Моя корзина', members: ['NVDA', 'AVGO'] });
    expect(c.hiddenBlocks).toEqual(['metals']);
    expect(c.blockTitles).toEqual({ countries: 'Страны мира' });
  });
});

describe('effectiveBlocks', () => {
  it('без настроек = сид', () => {
    const out = effectiveBlocks({});
    expect(out.map((b) => b.id)).toEqual(SEED_BLOCKS.map((b) => b.id));
  });

  it('скрывает блок, переименовывает, добавляет кастомную корзину', () => {
    const out = effectiveBlocks({
      hiddenBlocks: ['metals'],
      blockTitles: { countries: 'Страны мира' },
      customBaskets: [{ id: 'ai_infra', title: 'AI-инфраструктура', members: ['NVDA', 'AVGO', 'SMCI'] }],
    });
    const ids = out.map((b) => b.id);
    expect(ids).not.toContain('metals'); // скрыт
    expect(out.find((b) => b.id === 'countries')!.title).toBe('Страны мира'); // переименован
    const custom = out.find((b) => b.id === 'ai_infra')!;
    expect(custom.type).toBe('basket');
    expect(custom.custom).toBe(true);
    expect(custom.benchmark).toBe('SPY');
    expect(custom.members).toEqual(['NVDA', 'AVGO', 'SMCI']);
    expect(ids[ids.length - 1]).toBe('ai_infra'); // кастомные в конце
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
