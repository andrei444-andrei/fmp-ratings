// Текстовый контекст портфеля для AI-чата: стратегии, их годовые метрики и сравнение
// с SPY — чтобы ассистент отвечал по реальным данным, а не выдумывал.

import { listAlgorithms } from './algorithms';
import { buildPortfolio } from './portfolio';

function pct(v: number | null | undefined, d = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100;
  return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(d) + '%';
}

export async function buildChatContext(): Promise<string> {
  const [algos, pf] = await Promise.all([listAlgorithms(), buildPortfolio(false, true)]);
  const metaById = new Map(algos.map(a => [a.id, a]));
  const lines: string[] = [];

  lines.push(`Бенчмарк: ${pf.benchmark?.name || 'SPY'}.`);
  lines.push(`Годы анализа: ${pf.years.length ? `${pf.years[0]}–${pf.years[pf.years.length - 1]}` : 'нет данных'}.`);
  lines.push(`Стратегий в портфеле: ${pf.algos.length}.`);

  for (const c of pf.algos) {
    const meta = metaById.get(c.id);
    lines.push('');
    lines.push(`Стратегия «${c.name}» (статус: ${meta?.status || '—'}, project #${c.projectId}).`);
    if (meta?.description) lines.push(`Описание: ${meta.description.replace(/\s+/g, ' ').trim().slice(0, 600)}`);
    if (c.error) { lines.push(`Данные недоступны: ${c.error}`); continue; }
    let beat = 0, comp = 0;
    for (const y of pf.years) {
      const m = c.years[y]; if (!m) continue;
      const b = pf.benchmark?.years[y];
      let vs = '';
      if (b && m.ret != null && b.ret != null) { comp++; if (m.ret > b.ret) { beat++; vs = ' (обыграла SPY)'; } else vs = ' (хуже SPY)'; }
      lines.push(`  ${y}: доходность ${pct(m.ret)}, макс. просадка ${pct(m.maxDD)}${vs}`);
    }
    lines.push(`  Итог накопит.: ${pct(c.totalReturn)}; лет лучше SPY: ${beat}/${comp}.`);
  }

  if (pf.benchmark && pf.years.length) {
    lines.push('');
    lines.push('SPY по годам:');
    for (const y of pf.years) {
      const b = pf.benchmark.years[y];
      if (b) lines.push(`  ${y}: доходность ${pct(b.ret)}, просадка ${pct(b.maxDD)}`);
    }
  }

  return lines.join('\n').slice(0, 14000);
}
