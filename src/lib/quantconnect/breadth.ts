// Сводка по концентрации портфеля (число позиций по месяцам). Чистый модуль без
// server-зависимостей — безопасно импортировать в клиентских компонентах.

import type { MonthBreadth } from './allocation';

export type BreadthBucket = { k: string; count: number; pct: number };
export type BreadthYear = { year: number; months: number; avgN: number; pctSingle: number; maxTop1: number };
export type BreadthSummary = {
  months: number;        // всего месяцев в таймлайне
  inMarket: number;      // месяцев с позициями (n≥1)
  avgN: number;          // среднее число позиций (по месяцам в рынке)
  pctCash: number;       // доля месяцев в кэше (n=0), 0..1
  pctSingle: number;     // доля месяцев с РОВНО 1 позицией (среди месяцев в рынке), 0..1
  avgTop1: number;       // средняя доля крупнейшей позиции (в рынке), 0..1
  maxTop1: number;       // макс. доля крупнейшей позиции, 0..1
  dist: BreadthBucket[]; // распределение по числу позиций: «кэш»,1,2,3,4,5+ (% от всех месяцев)
  perYear: BreadthYear[];
};

const bucketKey = (n: number) => (n <= 0 ? 'кэш' : n >= 5 ? '5+' : String(n));
const ORDER = ['кэш', '1', '2', '3', '4', '5+'];

export function summarizeBreadth(breadth: MonthBreadth[]): BreadthSummary {
  const months = breadth.length;
  const inMarketRows = breadth.filter(b => b.n >= 1);
  const inMarket = inMarketRows.length;
  const cash = months - inMarket;
  const single = inMarketRows.filter(b => b.n === 1).length;
  const sumN = inMarketRows.reduce((s, b) => s + b.n, 0);
  const sumTop1 = inMarketRows.reduce((s, b) => s + b.top1, 0);
  const maxTop1 = inMarketRows.reduce((m, b) => Math.max(m, b.top1), 0);

  const counts = new Map<string, number>();
  for (const b of breadth) counts.set(bucketKey(b.n), (counts.get(bucketKey(b.n)) || 0) + 1);
  const dist: BreadthBucket[] = ORDER
    .filter(k => counts.has(k))
    .map(k => ({ k, count: counts.get(k)!, pct: months ? counts.get(k)! / months : 0 }));

  const byYear = new Map<number, MonthBreadth[]>();
  for (const b of breadth) {
    const y = Number(b.ym.slice(0, 4));
    (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(b);
  }
  const perYear: BreadthYear[] = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, rows]) => {
    const inMkt = rows.filter(r => r.n >= 1);
    const n = inMkt.length;
    return {
      year,
      months: rows.length,
      avgN: n ? inMkt.reduce((s, r) => s + r.n, 0) / n : 0,
      pctSingle: n ? inMkt.filter(r => r.n === 1).length / n : 0,
      maxTop1: rows.reduce((m, r) => Math.max(m, r.top1), 0),
    };
  });

  return {
    months,
    inMarket,
    avgN: inMarket ? sumN / inMarket : 0,
    pctCash: months ? cash / months : 0,
    pctSingle: inMarket ? single / inMarket : 0,
    avgTop1: inMarket ? sumTop1 / inMarket : 0,
    maxTop1,
    dist,
    perYear,
  };
}
