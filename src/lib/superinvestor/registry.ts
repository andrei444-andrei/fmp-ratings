// Курируемый список 13F-филеров. CIK сверены по SEC EDGAR (10-значные, с нулями).
// Buffett — витринный пример раздела.

import type { Investor } from './types';

export const INVESTORS: Investor[] = [
  { slug: 'buffett', name: 'Warren Buffett', fund: 'Berkshire Hathaway', cik: '0001067983', type: 'value',
    blurb: 'Концентрированный value, длинный горизонт, минимальный оборот портфеля.' },
  { slug: 'ackman', name: 'Bill Ackman', fund: 'Pershing Square Capital', cik: '0001336528', type: 'activist',
    blurb: 'Активист-концентратор: 8–12 крупных ставок, влияние на менеджмент.' },
  { slug: 'burry', name: 'Michael Burry', fund: 'Scion Asset Management', cik: '0001649339', type: 'concentrated',
    blurb: 'Контрарианец «Big Short», резкие развороты, высокий оборот.' },
  { slug: 'klarman', name: 'Seth Klarman', fund: 'Baupost Group', cik: '0001061768', type: 'value',
    blurb: 'Маржа безопасности, спецситуации, склонность держать кэш.' },
  { slug: 'tepper', name: 'David Tepper', fund: 'Appaloosa Management', cik: '0001006438', type: 'macro',
    blurb: 'Макро + distressed, гибкая ротация между tech и циклическими.' },
  { slug: 'marks', name: 'Howard Marks', fund: 'Oaktree Capital', cik: '0000949509', type: 'value',
    blurb: 'Кредит и distressed, дисциплина цикла «риск/доходность».' },
  { slug: 'lilu', name: 'Li Lu', fund: 'Himalaya Capital', cik: '0001709323', type: 'concentrated',
    blurb: 'Ученик Мангера: сверхконцентрация, очень длинный горизонт.' },
  { slug: 'pabrai', name: 'Mohnish Pabrai', fund: 'Pabrai Investments', cik: '0001173334', type: 'concentrated',
    blurb: 'Few bets, big bets: подход Кельвина к ставкам, дешёвые компании.' },
  { slug: 'loeb', name: 'Daniel Loeb', fund: 'Third Point', cik: '0001040273', type: 'activist',
    blurb: 'Активист-event-driven, письма менеджменту, гибкий оборот.' },
  { slug: 'icahn', name: 'Carl Icahn', fund: 'Icahn Capital', cik: '0001412093', type: 'activist',
    blurb: 'Классический корпоративный рейдер-активист, крупные доли.' },
];

export function investorBySlug(slug: string): Investor | undefined {
  return INVESTORS.find(i => i.slug === slug);
}
