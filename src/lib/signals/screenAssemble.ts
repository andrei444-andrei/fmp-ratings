// Чистая сборка панели вселенной из per-ticker наблюдений (без БД/Pyodide) — для кэша скринера.
// Выделено отдельно, чтобы юнит-тесты не тянули серверные зависимости.

import type { ScreenPanel } from './screen';
import { OUTN } from './screen';

// Наблюдение тикера для кэша: [dateISO, ret, exc, mfe, mae, mdd, v0..vN] — исходы (OUTN штук) затем факторы.
export type TickerObs = (number | string | null)[];
export type TickerPanel = { cols: string[]; obs: TickerObs[]; first: string; last: string };

// Сборка ПАНЕЛИ ВСЕЛЕННОЙ из закэшированных тикеров.
// Строка панели: [symIdx, dateIdx, <OUTN исходов>, <факторы по cols>].
export function assembleUniverse(symbols: string[], horizon: number, perTicker: Map<string, TickerPanel>, cols: string[]): ScreenPanel {
  const present = symbols.filter((s) => perTicker.has(s) && perTicker.get(s)!.obs.length);
  const dateSet = new Set<string>();
  for (const s of present) for (const r of perTicker.get(s)!.obs) dateSet.add(String(r[0]));
  const dates = [...dateSet].sort();
  const didx = new Map(dates.map((d, i) => [d, i]));
  const rows: (number | null)[][] = [];
  present.forEach((s, si) => {
    for (const r of perTicker.get(s)!.obs) {
      const row: (number | null)[] = [si, didx.get(String(r[0]))!];
      for (let k = 0; k < OUTN; k++) row.push((r[1 + k] as number | null) ?? null); // исходы
      for (let k = 0; k < cols.length; k++) row.push((r[1 + OUTN + k] as number | null) ?? null); // факторы
      rows.push(row);
    }
  });
  return {
    symbols: present, dates, cols, rows, horizon,
    meta: { symbols: present.length, obs: rows.length, first: dates[0] || '', last: dates[dates.length - 1] || '', horizon },
  };
}

// Разбор результата движка screen (вся недостающая вселенная) → obs по каждому тикеру для кэша.
export function splitEngineResult(res: { symbols: string[]; dates: string[]; cols: string[]; rows: (number | null)[][] }): { cols: string[]; perTicker: Map<string, TickerObs[]> } {
  const per = new Map<string, TickerObs[]>();
  res.symbols.forEach((s) => per.set(s, []));
  for (const row of res.rows) {
    const sym = res.symbols[row[0] as number];
    const date = res.dates[row[1] as number];
    const obs: TickerObs = [date];
    for (let k = 0; k < OUTN; k++) obs.push(row[2 + k] as number | null); // исходы
    for (let k = 0; k < res.cols.length; k++) obs.push(row[2 + OUTN + k] as number | null); // факторы
    per.get(sym)?.push(obs);
  }
  for (const arr of per.values()) arr.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  return { cols: res.cols, perTicker: per };
}
