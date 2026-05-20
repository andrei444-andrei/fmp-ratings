// Статистика по временным рядам: Z-score, YoY, спарклайн, цветовые корзины,
// композитный Global Leverage Index.

export type Obs = { date: string; value: number };

export type SeriesStats = {
  latest: Obs | null;
  prev: Obs | null;
  zscore: number | null;     // z последнего значения относительно окна
  yoyPct: number | null;     // % изменения год к году (по дате)
  changePct: number | null;  // % изменения относительно предыдущего наблюдения
  level: 'green' | 'amber' | 'red' | 'na'; // светофор по |z|, с учётом направления риска
  windowN: number;
  sparkline: number[];        // последние 12 значений (для мини-графика)
};

// Z-score последнего значения относительно скользящего окна (по умолчанию 5 лет).
function rollingZ(values: number[], windowSize: number): number | null {
  if (values.length < 4) return null;
  const win = values.slice(-windowSize);
  const n = win.length;
  const mean = win.reduce((a, b) => a + b, 0) / n;
  const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd < 1e-9) return null;
  return (win[n - 1] - mean) / sd;
}

// Приблизительное число наблюдений в 5 годах по частоте.
function windowFor(freq: string): number {
  switch (freq) {
    case 'daily': return 5 * 252;
    case 'weekly': return 5 * 52;
    case 'monthly': return 5 * 12;
    case 'quarterly': return 5 * 4;
    default: return 60;
  }
}

function yoy(obs: Obs[]): number | null {
  if (obs.length < 2) return null;
  const last = obs[obs.length - 1];
  const target = new Date(last.date);
  target.setFullYear(target.getFullYear() - 1);
  const targetTs = target.getTime();
  // ближайшее наблюдение к дате год назад
  let best: Obs | null = null;
  let bestDiff = Infinity;
  for (const o of obs) {
    const diff = Math.abs(new Date(o.date).getTime() - targetTs);
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  }
  // допускаем расхождение до ~45 дней
  if (!best || bestDiff > 45 * 864e5) return null;
  if (Math.abs(best.value) < 1e-9) return null;
  return (last.value - best.value) / Math.abs(best.value) * 100;
}

// |z| → светофор. higherIsRisk инвертирует знак: для «меньше = больше риска»
// рассматриваем отрицательный z как опасный.
function levelFor(z: number | null, higherIsRisk: boolean): SeriesStats['level'] {
  if (z == null) return 'na';
  const directional = higherIsRisk ? z : -z;
  if (directional >= 2) return 'red';
  if (directional >= 1) return 'amber';
  return 'green';
}

export function computeStats(obs: Obs[], freq: string, higherIsRisk: boolean): SeriesStats {
  const sorted = [...obs].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map(o => o.value);
  const z = rollingZ(values, windowFor(freq));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const changePct = latest && prev && Math.abs(prev.value) > 1e-9
    ? (latest.value - prev.value) / Math.abs(prev.value) * 100
    : null;
  return {
    latest,
    prev,
    zscore: z,
    yoyPct: yoy(sorted),
    changePct,
    level: levelFor(z, higherIsRisk),
    windowN: Math.min(values.length, windowFor(freq)),
    sparkline: values.slice(-12),
  };
}

// Композитный индекс: средневзвешенный directional z-score по сегментам.
// Сначала усредняем z внутри сегмента, потом усредняем сегменты (равный вес).
export function compositeIndex(
  items: Array<{ segment: string; zscore: number | null; higherIsRisk: boolean }>,
): { value: number | null; bySegment: Record<string, number | null>; level: SeriesStats['level'] } {
  const bySeg: Record<string, number[]> = {};
  for (const it of items) {
    if (it.zscore == null) continue;
    const directional = it.higherIsRisk ? it.zscore : -it.zscore;
    (bySeg[it.segment] = bySeg[it.segment] || []).push(directional);
  }
  const bySegment: Record<string, number | null> = {};
  const segMeans: number[] = [];
  for (const [seg, arr] of Object.entries(bySeg)) {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    bySegment[seg] = m;
    segMeans.push(m);
  }
  if (!segMeans.length) return { value: null, bySegment, level: 'na' };
  const value = segMeans.reduce((a, b) => a + b, 0) / segMeans.length;
  const level: SeriesStats['level'] = value >= 2 ? 'red' : value >= 1 ? 'amber' : 'green';
  return { value, bySegment, level };
}
