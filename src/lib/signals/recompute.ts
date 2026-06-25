// Клиентский пересчёт ячеек факторной карты из СЫРЫХ наблюдений (panel) — чтобы «крутилки»
// (живой фильтр выборки + окно лет) меняли карту МГНОВЕННО, без перепрогона Pyodide.
//
// Почему сырые наблюдения, а не достаточные статистики (как в по-годовом пересчёте): фильтр
// кросс-секционный — в одну дату разные тикеры попадают по разные стороны порога, поэтому
// по-датному среднему нельзя сложить бакеты. Считаем честно: фильтр → регион → группировка по дате.
//
// Паритет с движком (pstat): группируем по дате, берём по-датное среднее r, затем mean/t по
// по-датным средним (std ddof=1); hit = доля r>0 по ВСЕМ наблюдениям. Порог значимости n≥10, periods≥5.

export type LiveFilter = { enabled: boolean; side: 'high' | 'low'; threshold: number; op: 'exclude' | 'keep' };
// Панель группы: общий список дат + по каждому параметру массив наблюдений [di, f, v, r]:
//   di — индекс даты в dates; f — значение изучаемого фактора; v — значение фактора-фильтра; r — форвард (t_H, пп).
export type Panel = { dates: string[]; params: Record<string, number[][]> };
export type CellDef = { param: number | string; col: string; region: any };
export type CellStat = { mean: number; t: number; hit: number; n: number; periods: number } | null;

function inRegion(f: number, region: any, bins: string): boolean {
  if (!region) return false;
  const side = region.side;
  if (side === 'band') return f >= region.lo && f < region.hi; // диапазон: [lo, hi) — как в движке
  if (bins === 'range') return side === 'low' ? f < region.threshold : f >= region.threshold; // края диапазонов
  return side === 'high' ? f >= region.threshold : f <= region.threshold; // накопительно (≥/≤)
}

function statFromPerDate(sum: Map<number, number>, cnt: Map<number, number>, n: number, pos: number): CellStat {
  const keys = [...sum.keys()];
  const P = keys.length;
  if (n < 10 || P < 5) return null;
  const means = keys.map((d) => sum.get(d)! / cnt.get(d)!);
  const m = means.reduce((a, b) => a + b, 0) / P;
  let t = 0;
  if (P > 1) {
    const variance = means.reduce((a, b) => a + (b - m) * (b - m), 0) / (P - 1);
    const se = variance > 0 ? Math.sqrt(variance / P) : 0;
    t = se > 0 ? m / se : 0;
  }
  return { mean: m, t, hit: (pos / n) * 100, n, periods: P };
}

// Пересчёт всех ячеек грида под окно лет [yearFrom, yearTo] и живой фильтр.
export function recomputeCells(
  grid: CellDef[],
  panel: Panel,
  bins: string,
  yearFrom: number,
  yearTo: number,
  lf: LiveFilter,
): Map<string, CellStat> {
  const yearOf = panel.dates.map((d) => +d.slice(0, 4));
  const out = new Map<string, CellStat>();
  for (const cell of grid) {
    const obs = panel.params[String(cell.param)] || [];
    const sum = new Map<number, number>();
    const cnt = new Map<number, number>();
    let n = 0;
    let pos = 0;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const di = o[0], f = o[1], v = o[2], r = o[3];
      const y = yearOf[di];
      if (y < yearFrom || y > yearTo) continue;
      if (lf.enabled && Number.isFinite(v)) {
        const cond = lf.side === 'high' ? v >= lf.threshold : v <= lf.threshold;
        if (lf.op === 'exclude' ? cond : !cond) continue;
      }
      if (!inRegion(f, cell.region, bins)) continue;
      sum.set(di, (sum.get(di) || 0) + r);
      cnt.set(di, (cnt.get(di) || 0) + 1);
      n++;
      if (r > 0) pos++;
    }
    out.set(`${cell.param}:${cell.col}`, statFromPerDate(sum, cnt, n, pos));
  }
  return out;
}
