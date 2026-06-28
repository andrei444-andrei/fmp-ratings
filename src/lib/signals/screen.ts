// Клиентский движок скринера: по ПАНЕЛИ СДЕЛОК (наблюдений с факторами на входе + форвардными исходами)
// считает условия и метрики оценки мгновенно, без перепрогона. Конструктор как в Google Analytics:
// блоки соединяются ИЛИ, внутри блока условия по И, у каждого — инверсия НЕ. Разрезы по тикерам/годам,
// окно лет, hit-rate / средний / медиана + провал в сделки. Условия и столбцы могут ссылаться на
// ВЫЧИСЛЯЕМЫЕ МЕТРИКИ (формулы над факторами) — см. formula.ts.
//
// Панель: rows[i] = [symIdx, dateIdx, ret, exc, mfe, mae, mdd, v0, v1, ...] — сперва OUTN форвардных исходов
// (за горизонт H), затем факторы по cols. Всё пересчитывается на клиенте — сервер отдаёт панель один раз.

// Форвардные исходы строки (в %): порядок и смещения.
export const OUTCOMES = ['ret', 'exc', 'mfe', 'mae', 'mdd'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTN = OUTCOMES.length; // 5
const OUT_OFF = 2; // ret=2, exc=3, mfe=4, mae=5, mdd=6
const FAC_OFF = OUT_OFF + OUTN; // факторы начинаются с индекса 7
const RET = OUT_OFF + 0, EXC = OUT_OFF + 1, MFE = OUT_OFF + 2, MAE = OUT_OFF + 3, MDD = OUT_OFF + 4;

export type ScreenPanel = { symbols: string[]; dates: string[]; cols: string[]; rows: (number | null)[][]; horizon?: number; meta?: Record<string, any> };
export type Cmp = 'ge' | 'le';
export type Cond = { col: string; cmp: Cmp; val: number; not?: boolean };
export type Block = { conds: Cond[] };

// Вычисляемые метрики (формулы): имя → функция от getter'а факторов строки. См. compileFormula в formula.ts.
export type CellFn = (get: (n: string) => number | null) => number | null;
export type Formulas = Map<string, CellFn>;

export function colIndex(panel: ScreenPanel): Record<string, number> {
  const m: Record<string, number> = {};
  panel.cols.forEach((c, i) => (m[c] = i));
  return m;
}

// Getter значений базовых факторов строки по имени колонки.
function rowGetter(row: (number | null)[], ci: Record<string, number>): (n: string) => number | null {
  return (name) => {
    const i = ci[name];
    if (i === undefined) return null;
    const v = row[FAC_OFF + i];
    return v == null || !Number.isFinite(v as number) ? null : (v as number);
  };
}
// Значение «колонки» — базового фактора ИЛИ вычисляемой метрики (формулы) — для строки.
function cellValue(get: (n: string) => number | null, formulas: Formulas | undefined, key: string): number | null {
  const f = formulas?.get(key);
  return f ? f(get) : get(key);
}

function evalCond(v: number | null | undefined, c: Cond): boolean {
  if (v == null || !Number.isFinite(v)) return false; // метрика не определена → условие не подтверждено
  const ok = c.cmp === 'ge' ? v >= c.val : v <= c.val;
  return c.not ? !ok : ok;
}

// Сделка проходит, если выполнен ХОТЯ БЫ ОДИН блок (ИЛИ); блок выполнен, если ВСЕ его условия (И, с НЕ).
export function matchRow(row: (number | null)[], blocks: Block[], ci: Record<string, number>, formulas?: Formulas): boolean {
  const active = blocks.filter((b) => b.conds.length);
  if (!active.length) return true; // нет условий → все сделки
  const get = rowGetter(row, ci);
  return active.some((b) => b.conds.every((c) => evalCond(cellValue(get, formulas, c.col), c)));
}

export function totalConds(blocks: Block[]): number {
  return blocks.reduce((a, b) => a + b.conds.length, 0);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Год строки (для разреза/фильтра окна лет).
const rowYear = (panel: ScreenPanel, row: (number | null)[]) => +panel.dates[row[1] as number].slice(0, 4);
// Пропустить строку, если она вне окна лет (minYear включительно).
const outOfWindow = (panel: ScreenPanel, row: (number | null)[], minYear?: number) => minYear != null && rowYear(panel, row) < minYear;

// Агрегатор форвардных исходов матч-сделок.
type Agg = { ret: number[]; sumExc: number; sumMfe: number; sumMae: number; sumMdd: number; nExc: number };
const newAgg = (): Agg => ({ ret: [], sumExc: 0, sumMfe: 0, sumMae: 0, sumMdd: 0, nExc: 0 });
function pushOut(a: Agg, row: (number | null)[]) {
  const r = row[RET] as number | null; if (r != null && Number.isFinite(r)) a.ret.push(r);
  const e = row[EXC] as number | null; if (e != null && Number.isFinite(e)) { a.sumExc += e; a.nExc++; }
  const f = row[MFE] as number | null; if (f != null && Number.isFinite(f)) a.sumMfe += f;
  const v = row[MAE] as number | null; if (v != null && Number.isFinite(v)) a.sumMae += v;
  const d = row[MDD] as number | null; if (d != null && Number.isFinite(d)) a.sumMdd += d;
}
export type OutStats = { avgRet: number; medRet: number; hitPct: number; avgExc: number; avgMfe: number; avgMae: number; avgMdd: number };
function statsOf(a: Agg, n: number): OutStats {
  const nr = a.ret.length || 1;
  return {
    avgRet: a.ret.reduce((x, y) => x + y, 0) / nr,
    medRet: median(a.ret),
    hitPct: (a.ret.filter((x) => x > 0).length / nr) * 100,
    avgExc: a.sumExc / (a.nExc || 1),
    avgMfe: a.sumMfe / n, avgMae: a.sumMae / n, avgMdd: a.sumMdd / n,
  };
}

export type TickerRow = { symbol: string; n: number; disp: (number | null)[] } & OutStats;

// Разрез ПО ТИКЕРАМ: на каждый тикер — число матч-сделок, метрики оценки (return/hit/медиана/MFE/MAE/MaxDD/vs SPY)
// и средние «отображаемых» колонок (факторы И формулы). minYear — нижняя граница окна лет (включительно).
export function screenByTicker(panel: ScreenPanel, blocks: Block[], displayCols: string[], minYear?: number, formulas?: Formulas): TickerRow[] {
  const ci = colIndex(panel);
  const acc = new Map<number, { a: Agg; n: number; disp: number[]; dispN: number[] }>();
  for (const row of panel.rows) {
    if (outOfWindow(panel, row, minYear) || !matchRow(row, blocks, ci, formulas)) continue;
    const si = row[0] as number;
    let g = acc.get(si);
    if (!g) { g = { a: newAgg(), n: 0, disp: displayCols.map(() => 0), dispN: displayCols.map(() => 0) }; acc.set(si, g); }
    g.n++; pushOut(g.a, row);
    const get = rowGetter(row, ci);
    displayCols.forEach((col, k) => {
      const v = cellValue(get, formulas, col);
      if (v != null && Number.isFinite(v)) { g.disp[k] += v; g.dispN[k]++; }
    });
  }
  return [...acc.entries()]
    .map(([si, g]) => ({ symbol: panel.symbols[si], n: g.n, ...statsOf(g.a, g.n),
      disp: displayCols.map((_, k) => (g.dispN[k] ? g.disp[k] / g.dispN[k] : null)) }))
    .sort((x, y) => y.avgRet - x.avgRet);
}

export type YearRow = { year: number; n: number; tickers: number } & OutStats;

// Разрез ПО ГОДАМ: агрегат матч-сделок по календарному году (в окне лет).
export function screenByYear(panel: ScreenPanel, blocks: Block[], minYear?: number, formulas?: Formulas): YearRow[] {
  const ci = colIndex(panel);
  const acc = new Map<number, { a: Agg; n: number; syms: Set<number> }>();
  for (const row of panel.rows) {
    if (outOfWindow(panel, row, minYear) || !matchRow(row, blocks, ci, formulas)) continue;
    const y = rowYear(panel, row);
    let g = acc.get(y);
    if (!g) { g = { a: newAgg(), n: 0, syms: new Set() }; acc.set(y, g); }
    g.n++; pushOut(g.a, row); g.syms.add(row[0] as number);
  }
  return [...acc.entries()]
    .map(([year, g]) => ({ year, n: g.n, tickers: g.syms.size, ...statsOf(g.a, g.n) }))
    .sort((x, y) => x.year - y.year);
}

export type Deal = { date: string; symbol: string; ret: number; exc: number; mfe: number; mae: number; mdd: number; vals: Record<string, number | null> };

// Провал в сделки: матч-сделки по одному тикеру ('t') или по году ('y'), в окне лет. vals содержит и базовые
// факторы, и значения формул (по имени) — чтобы drawer показал любые выбранные столбцы.
export function screenDeals(panel: ScreenPanel, blocks: Block[], kind: 't' | 'y', kv: string, minYear?: number, formulas?: Formulas): Deal[] {
  const ci = colIndex(panel);
  const out: Deal[] = [];
  for (const row of panel.rows) {
    if (outOfWindow(panel, row, minYear) || !matchRow(row, blocks, ci, formulas)) continue;
    const sym = panel.symbols[row[0] as number];
    const date = panel.dates[row[1] as number];
    if (kind === 't' ? sym !== kv : date.slice(0, 4) !== kv) continue;
    const vals: Record<string, number | null> = {};
    panel.cols.forEach((c, i) => (vals[c] = row[FAC_OFF + i] as number | null));
    if (formulas?.size) { const get = rowGetter(row, ci); for (const [name, fn] of formulas) vals[name] = fn(get); }
    out.push({
      date, symbol: sym,
      ret: row[RET] as number, exc: row[EXC] as number, mfe: row[MFE] as number, mae: row[MAE] as number, mdd: row[MDD] as number,
      vals,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ВСЕ матч-сделки вселенной (для сводного вида и графика) — без разреза по тикеру/году, в окне лет.
export function screenAllDeals(panel: ScreenPanel, blocks: Block[], minYear?: number, formulas?: Formulas): Deal[] {
  const ci = colIndex(panel);
  const out: Deal[] = [];
  for (const row of panel.rows) {
    if (outOfWindow(panel, row, minYear) || !matchRow(row, blocks, ci, formulas)) continue;
    const vals: Record<string, number | null> = {};
    panel.cols.forEach((c, i) => (vals[c] = row[FAC_OFF + i] as number | null));
    if (formulas?.size) { const get = rowGetter(row, ci); for (const [name, fn] of formulas) vals[name] = fn(get); }
    out.push({
      date: panel.dates[row[1] as number], symbol: panel.symbols[row[0] as number],
      ret: row[RET] as number, exc: row[EXC] as number, mfe: row[MFE] as number, mae: row[MAE] as number, mdd: row[MDD] as number,
      vals,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Сводка по списку сделок (для drawer/свода). Собирает синтетические строки в формате панели и считает те же метрики.
export function dealStats(deals: Deal[]): OutStats & { n: number; tickers: number } {
  const a = newAgg();
  for (const d of deals) pushOut(a, [0, 0, d.ret, d.exc, d.mfe, d.mae, d.mdd]);
  return { n: deals.length, tickers: new Set(deals.map((d) => d.symbol)).size, ...statsOf(a, deals.length || 1) };
}
