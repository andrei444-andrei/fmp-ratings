// Клиентский движок скринера: по ПАНЕЛИ СДЕЛОК (наблюдений с факторами на входе + форвард) считает
// условия мгновенно, без перепрогона. Конструктор как в Google Analytics: блоки соединяются ИЛИ,
// внутри блока условия по И, у каждого — инверсия НЕ. Разрезы по тикерам/годам + провал в сделки.
//
// Панель: rows[i] = [symIdx, dateIdx, fwd, v0, v1, ...] (факторы по cols, смещение 3). Всё пересчитывается
// на клиенте — сервер отдаёт панель один раз (на смену вселенной/горизонта).

export type ScreenPanel = { symbols: string[]; dates: string[]; cols: string[]; rows: (number | null)[][]; horizon?: number; meta?: Record<string, any> };
export type Cmp = 'ge' | 'le';
export type Cond = { col: string; cmp: Cmp; val: number; not?: boolean };
export type Block = { conds: Cond[] };

export function colIndex(panel: ScreenPanel): Record<string, number> {
  const m: Record<string, number> = {};
  panel.cols.forEach((c, i) => (m[c] = i));
  return m;
}

function evalCond(v: number | null | undefined, c: Cond): boolean {
  if (v == null || !Number.isFinite(v)) return false; // метрика не определена → условие не подтверждено
  const ok = c.cmp === 'ge' ? v >= c.val : v <= c.val;
  return c.not ? !ok : ok;
}

// Сделка проходит, если выполнен ХОТЯ БЫ ОДИН блок (ИЛИ); блок выполнен, если ВСЕ его условия (И, с НЕ).
export function matchRow(row: (number | null)[], blocks: Block[], ci: Record<string, number>): boolean {
  const active = blocks.filter((b) => b.conds.length);
  if (!active.length) return true; // нет условий → все сделки
  return active.some((b) => b.conds.every((c) => evalCond(row[3 + (ci[c.col] ?? -1e9)] as number, c)));
}

export function totalConds(blocks: Block[]): number {
  return blocks.reduce((a, b) => a + b.conds.length, 0);
}

export type TickerRow = { symbol: string; n: number; avgFwd: number; hitPct: number; disp: (number | null)[] };

// Разрез ПО ТИКЕРАМ: на каждый тикер — число матч-сделок, ср. форвард, доля плюс, средние «отображаемых» метрик.
export function screenByTicker(panel: ScreenPanel, blocks: Block[], displayCols: string[]): TickerRow[] {
  const ci = colIndex(panel);
  const acc = new Map<number, { n: number; sumFwd: number; pos: number; disp: number[]; dispN: number[] }>();
  for (const row of panel.rows) {
    if (!matchRow(row, blocks, ci)) continue;
    const si = row[0] as number;
    const fwd = row[2] as number;
    let a = acc.get(si);
    if (!a) { a = { n: 0, sumFwd: 0, pos: 0, disp: displayCols.map(() => 0), dispN: displayCols.map(() => 0) }; acc.set(si, a); }
    a.n++; a.sumFwd += fwd; if (fwd > 0) a.pos++;
    displayCols.forEach((col, k) => {
      const v = row[3 + (ci[col] ?? -1e9)] as number;
      if (v != null && Number.isFinite(v)) { a.disp[k] += v; a.dispN[k]++; }
    });
  }
  return [...acc.entries()]
    .map(([si, a]) => ({ symbol: panel.symbols[si], n: a.n, avgFwd: a.sumFwd / a.n, hitPct: (a.pos / a.n) * 100,
      disp: displayCols.map((_, k) => (a.dispN[k] ? a.disp[k] / a.dispN[k] : null)) }))
    .sort((x, y) => y.avgFwd - x.avgFwd);
}

export type YearRow = { year: number; n: number; tickers: number; avgFwd: number; hitPct: number };

// Разрез ПО ГОДАМ: агрегат матч-сделок по календарному году.
export function screenByYear(panel: ScreenPanel, blocks: Block[]): YearRow[] {
  const ci = colIndex(panel);
  const acc = new Map<number, { n: number; sumFwd: number; pos: number; syms: Set<number> }>();
  for (const row of panel.rows) {
    if (!matchRow(row, blocks, ci)) continue;
    const y = +panel.dates[row[1] as number].slice(0, 4);
    let a = acc.get(y);
    if (!a) { a = { n: 0, sumFwd: 0, pos: 0, syms: new Set() }; acc.set(y, a); }
    a.n++; a.sumFwd += row[2] as number; if ((row[2] as number) > 0) a.pos++; a.syms.add(row[0] as number);
  }
  return [...acc.entries()]
    .map(([year, a]) => ({ year, n: a.n, tickers: a.syms.size, avgFwd: a.sumFwd / a.n, hitPct: (a.pos / a.n) * 100 }))
    .sort((x, y) => x.year - y.year);
}

export type Deal = { date: string; symbol: string; fwd: number; vals: Record<string, number | null> };

// Провал в сделки: матч-сделки по одному тикеру ('t') или по году ('y').
export function screenDeals(panel: ScreenPanel, blocks: Block[], kind: 't' | 'y', kv: string): Deal[] {
  const ci = colIndex(panel);
  const out: Deal[] = [];
  for (const row of panel.rows) {
    if (!matchRow(row, blocks, ci)) continue;
    const sym = panel.symbols[row[0] as number];
    const date = panel.dates[row[1] as number];
    if (kind === 't' ? sym !== kv : date.slice(0, 4) !== kv) continue;
    const vals: Record<string, number | null> = {};
    panel.cols.forEach((c, i) => (vals[c] = row[3 + i] as number | null));
    out.push({ date, symbol: sym, fwd: row[2] as number, vals });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
