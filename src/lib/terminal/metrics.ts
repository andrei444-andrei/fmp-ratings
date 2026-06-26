// Движок метрик рыночного терминала. Чистые функции от ряда дневных цен (adjusted_close
// из getPrices). Доходности считаются ПО ИНДЕКСАМ массива торговых дней, не по календарю;
// волатильность — annualized из дневных лог-доходностей ×√252. Новых провайдеров не нужно.
import { RET_WINDOWS, type InstrumentMetrics } from './types';

export type Bar = { date: string; close: number };

/** Доходность за N торговых дней: last vs close N баров назад, %. null если истории мало. */
export function pctReturnOverWindow(closes: number[], n: number): number | null {
  if (n <= 0 || closes.length <= n) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - n];
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
  return ((last - prev) / prev) * 100;
}

/** Дневные лог-доходности ряда (для волатильности и z-score). */
export function dailyLogReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  return r;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Annualized волатильность по последним N барам, % (×√252). null если истории мало. */
export function annualizedVol(closes: number[], n: number): number | null {
  if (closes.length <= n + 1) return null;
  const lr = dailyLogReturns(closes.slice(-(n + 1)));
  const sd = stdev(lr);
  return sd == null ? null : sd * Math.sqrt(252) * 100;
}

/** Z-score последней дневной доходности относительно распределения за lookback дней. */
export function zScoreOfDailyReturn(closes: number[], lookback = 63): number | null {
  if (closes.length <= lookback + 1) return null;
  const lr = dailyLogReturns(closes.slice(-(lookback + 1)));
  if (lr.length < 6) return null;
  const last = lr[lr.length - 1];
  const hist = lr.slice(0, -1);
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const sd = stdev(hist);
  // Вырожденная история (почти постоянный ряд, sd≈0) → z не определён. Порог много меньше
  // реальной дневной волатильности (~1e-2 в лог-доходностях), но выше fp-шума (~1e-16).
  if (sd == null || sd < 1e-9) return null;
  return (last - mean) / sd;
}

/** Положение последней цены в 52-нед (252д) диапазоне [0..100]%. */
export function pct52wRange(closes: number[]): number | null {
  const w = closes.slice(-252);
  if (w.length < 2) return null;
  const lo = Math.min(...w);
  const hi = Math.max(...w);
  if (hi === lo) return null;
  return ((w[w.length - 1] - lo) / (hi - lo)) * 100;
}

/** Простая скользящая средняя по последним N барам. */
export function sma(closes: number[], n: number): number | null {
  if (closes.length < n || n <= 0) return null;
  const w = closes.slice(-n);
  return w.reduce((a, b) => a + b, 0) / n;
}

export function startOfYearISO(dateISO: string): string {
  return dateISO.slice(0, 4) + '-01-01';
}
export function startOfMonthISO(dateISO: string): string {
  return dateISO.slice(0, 7) + '-01';
}
export function startOfQuarterISO(dateISO: string): string {
  const y = dateISO.slice(0, 4);
  const m = Number(dateISO.slice(5, 7));
  const qm = [1, 4, 7, 10][Math.floor((m - 1) / 3)];
  return `${y}-${String(qm).padStart(2, '0')}-01`;
}

/** Календарная доходность от первого бара на/после границы периода до последнего, %. */
export function calendarReturn(bars: Bar[], boundaryISO: string): number | null {
  if (!bars.length) return null;
  const idx = bars.findIndex((b) => b.date >= boundaryISO);
  if (idx < 0 || idx >= bars.length - 0) {
    return null;
  }
  const base = bars[idx].close;
  const last = bars[bars.length - 1].close;
  if (!Number.isFinite(base) || base === 0) return null;
  return ((last - base) / base) * 100;
}

/** Прореживание ряда до ~target точек (для спарклайна), сохраняя первую и последнюю. */
export function downsample(closes: number[], target = 80): number[] {
  if (closes.length <= target) return closes.slice();
  const out: number[] = [];
  const step = (closes.length - 1) / (target - 1);
  for (let i = 0; i < target; i++) out.push(closes[Math.round(i * step)]);
  return out;
}

/** Корреляция Пирсона двух выровненных рядов дневных доходностей. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  if (sx === 0 || sy === 0) return null;
  return sxy / Math.sqrt(sx * sy);
}

/** Полный набор метрик инструмента из ряда баров. null если истории совсем нет. */
export function computeInstrumentMetrics(bars: Bar[]): InstrumentMetrics | null {
  const clean = bars.filter((b) => Number.isFinite(b.close) && b.close > 0);
  if (clean.length < 2) return null;
  const closes = clean.map((b) => b.close);
  const last = closes[closes.length - 1];
  const asOf = clean[clean.length - 1].date;

  const returns: Record<number, number | null> = {};
  for (const w of RET_WINDOWS) returns[w] = pctReturnOverWindow(closes, w);

  const vol21 = annualizedVol(closes, 21);
  const vol63 = annualizedVol(closes, 63);
  const ma200 = sma(closes, 200);

  return {
    symbol: '',
    last,
    asOf,
    returns,
    mtd: calendarReturn(clean, startOfMonthISO(asOf)),
    qtd: calendarReturn(clean, startOfQuarterISO(asOf)),
    ytd: calendarReturn(clean, startOfYearISO(asOf)),
    vol21,
    vol63,
    volRatio: vol21 != null && vol63 != null && vol63 !== 0 ? vol21 / vol63 : null,
    z63: zScoreOfDailyReturn(closes, 63),
    pct52w: pct52wRange(closes),
    aboveMA200: ma200 == null ? null : last > ma200,
    excess63: null,
    spark: downsample(closes, 80),
  };
}
