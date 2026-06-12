// Полный текстовый контекст портфеля для AI-чата: по каждой стратегии — описание,
// торгуемые инструменты (из кода), статистика бектеста (Sharpe/Sortino/трейды/win-rate),
// реальная дневная просадка с датами, лучший/худший месяц и годовая разбивка vs SPY.

import { listAlgorithms } from './algorithms';
import { buildPortfolio, buildSeries } from './portfolio';
import { getStrategyFacts, type StrategyFacts } from './strategy-facts';
import type { DayPoint } from './types';

function pct(v: number | null | undefined, d = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100;
  return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(d) + '%';
}

// Реальная дневная макс. просадка + даты пика и дна.
function maxDDInfo(daily: DayPoint[]): { dd: number; peak: string; trough: string } | null {
  if (daily.length < 2) return null;
  let peakV = daily[0].v, peakD = daily[0].d, mdd = 0, atPeak = daily[0].d, atTrough = daily[0].d;
  for (const p of daily) {
    if (p.v > peakV) { peakV = p.v; peakD = p.d; }
    const dd = peakV > 0 ? p.v / peakV - 1 : 0;
    if (dd < mdd) { mdd = dd; atPeak = peakD; atTrough = p.d; }
  }
  return mdd < 0 ? { dd: mdd, peak: atPeak, trough: atTrough } : null;
}

function monthlyExtremes(daily: DayPoint[]): { best?: { ym: string; r: number }; worst?: { ym: string; r: number } } {
  const byMonth = new Map<string, number>();
  for (const p of daily) byMonth.set(p.d.slice(0, 7), p.v); // последнее значение месяца (daily отсортирован)
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let best: { ym: string; r: number } | undefined, worst: { ym: string; r: number } | undefined;
  for (let i = 1; i < months.length; i++) {
    const r = months[i][1] / months[i - 1][1] - 1;
    if (!isFinite(r)) continue;
    if (!best || r > best.r) best = { ym: months[i][0], r };
    if (!worst || r < worst.r) worst = { ym: months[i][0], r };
  }
  return { best, worst };
}

export async function buildChatContext(): Promise<string> {
  const [algos, pf, sr] = await Promise.all([listAlgorithms(), buildPortfolio(false, true), buildSeries(false, true)]);
  const metaById = new Map(algos.map(a => [a.id, a]));
  const dailyById = new Map(sr.algos.map(a => [a.id, a.daily]));

  // статистика + торгуемые инструменты по каждой стратегии (параллельно, кэшируется)
  const factsById = new Map<number, StrategyFacts>();
  await Promise.all(pf.algos.map(async c => {
    if (c.resolvedBacktestId && !c.error) {
      try { factsById.set(c.id, await getStrategyFacts(c.projectId, c.resolvedBacktestId)); } catch { /* пропускаем */ }
    }
  }));

  const lines: string[] = [];
  lines.push(`Бенчмарк: ${pf.benchmark?.name || 'SPY'}.`);
  lines.push(`Годы анализа: ${pf.years.length ? `${pf.years[0]}–${pf.years[pf.years.length - 1]}` : 'нет данных'}.`);
  lines.push(`Стратегий в портфеле: ${pf.algos.length}.`);

  for (const c of pf.algos) {
    const meta = metaById.get(c.id);
    const facts = factsById.get(c.id);
    const daily = dailyById.get(c.id) || [];
    lines.push('');
    lines.push(`### Стратегия «${c.name}» (статус: ${meta?.status || '—'}, project #${c.projectId})`);
    if (meta?.description) lines.push(`Описание: ${meta.description.replace(/\s+/g, ' ').trim().slice(0, 700)}`);
    if (facts?.symbols.length) lines.push(`Торгуемые инструменты (извлечены из кода): ${facts.symbols.join(', ')}.`);
    if (c.error) { lines.push(`Данные недоступны: ${c.error}`); continue; }

    const dd = maxDDInfo(daily);
    if (dd) lines.push(`Реальная макс. просадка (дневная): ${pct(dd.dd)} (пик ${dd.peak} → дно ${dd.trough}).`);
    const mx = monthlyExtremes(daily);
    if (mx.best && mx.worst) lines.push(`Лучший месяц: ${mx.best.ym} (${pct(mx.best.r)}); худший: ${mx.worst.ym} (${pct(mx.worst.r)}).`);

    if (facts && Object.keys(facts.statistics).length) {
      lines.push('Статистика бектеста:');
      for (const [k, v] of Object.entries(facts.statistics)) lines.push(`  ${k}: ${v}`);
    }

    let beat = 0, comp = 0;
    lines.push('По годам (доходность / макс. просадка за год / vs SPY):');
    for (const y of pf.years) {
      const m = c.years[y]; if (!m) continue;
      const b = pf.benchmark?.years[y];
      let vs = '';
      if (b && m.ret != null && b.ret != null) { comp++; if (m.ret > b.ret) { beat++; vs = ' (>SPY)'; } else vs = ' (<SPY)'; }
      lines.push(`  ${y}: ${pct(m.ret)} / ${pct(m.maxDD)}${vs}`);
    }
    lines.push(`Итог накопит.: ${pct(c.totalReturn)}; лет лучше SPY: ${beat}/${comp}.`);
  }

  if (pf.benchmark && pf.years.length) {
    lines.push('');
    lines.push('SPY по годам (доходность / просадка):');
    for (const y of pf.years) {
      const b = pf.benchmark.years[y];
      if (b) lines.push(`  ${y}: ${pct(b.ret)} / ${pct(b.maxDD)}`);
    }
  }

  return lines.join('\n').slice(0, 22000);
}
