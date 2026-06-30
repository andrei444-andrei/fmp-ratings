import { describe, it, expect } from 'vitest';
import { classify } from './radar';

// Классификатор радара на РЕАЛЬНЫХ названиях событий FMP: нужная версия метрики матчится,
// суб-метрики и иные шкалы (продолжающие заявки, U-6, индекс-уровень PPI, Private NFP,
// Business Activity, MoM-двойники инфляции) — отбрасываются.
describe('radar classify', () => {
  const id = (name: string) => classify(name)?.id ?? null;

  it('инфляция: берём годовую (YoY), месячную (MoM) — отбрасываем', () => {
    expect(id('Inflation Rate YoY (May)')).toBe('cpi');
    expect(id('Inflation Rate MoM (Apr)')).toBe(null);
    expect(id('Core Inflation Rate YoY (May)')).toBe('core_cpi');
    expect(id('Core Inflation Rate MoM (Jun)')).toBe(null);
    expect(id('Core PCE Price Index YoY (Mar)')).toBe('core_pce');
    expect(id('Core PCE Price Index MoM (Apr)')).toBe(null);
    expect(id('PCE Price Index YoY (May)')).toBe('pce');
    expect(id('PCE Price Index MoM (May)')).toBe(null);
  });

  it('заявки: только первичные; продолжающие и 4-недельное среднее — мимо', () => {
    expect(id('Initial Jobless Claims (May/02)')).toBe('claims');
    expect(id('Continuing Jobless Claims (May/16)')).toBe(null);
    expect(id('Jobless Claims 4-Week Average (Jul/04)')).toBe(null);
  });

  it('безработица: обычная, но не U-6', () => {
    expect(id('Unemployment Rate (Apr)')).toBe('unemployment');
    expect(id('U-6 Unemployment Rate (Jun)')).toBe(null);
  });

  it('PPI: месячный %, не индекс-уровень и не core', () => {
    expect(id('Producer Price Index MoM (Jun)')).toBe('ppi');
    expect(id('Producer Price Index (Apr)')).toBe(null); // индекс-уровень (~156) — мимо
    expect(id('PPI Ex Food, Energy and Trade MoM (May)')).toBe(null);
  });

  it('NFP без Private; розница headline MoM без Ex-Autos/YoY', () => {
    expect(id('Non Farm Payrolls (Jun)')).toBe('nfp');
    expect(id('Nonfarm Payrolls Private (Jul)')).toBe(null);
    expect(id('Retail Sales MoM (Jul)')).toBe('retail');
    expect(id('Retail Sales Ex Autos MoM (Apr)')).toBe(null);
    expect(id('Retail Sales YoY (Jun)')).toBe(null);
  });

  it('ISM headline без суб-индексов; ВВП QoQ; Мичиган без под-индексов', () => {
    expect(id('ISM Manufacturing PMI (Jun)')).toBe('ism_mfg');
    expect(id('ISM Non-Manufacturing PMI (Apr)')).toBe('ism_svc');
    expect(id('ISM Non-Manufacturing Business Activity (May)')).toBe(null);
    expect(id('GDP Growth Rate QoQ (Q2)')).toBe('gdp');
    expect(id('GDP Price Index QoQ (Q2)')).toBe(null);
    expect(id('Michigan Consumer Sentiment (May)')).toBe('michigan');
    expect(id('Michigan Consumer Expectations (May)')).toBe(null);
  });

  it('ФРС и шум', () => {
    expect(id('Fed Interest Rate Decision')).toBe('fomc_rate');
    expect(id('FOMC Minutes')).toBe('fomc_minutes');
    expect(id('Dallas Fed Manufacturing Index (Jun)')).toBe(null);
    expect(id('EIA Crude Oil Stocks Change')).toBe(null);
    expect(id('Building Permits (May)')).toBe(null);
    expect(id('')).toBe(null);
  });
});
