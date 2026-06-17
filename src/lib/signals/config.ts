// Нормализация/валидация конфига исследования (недоверенный ввод с клиента → безопасный объект
// для Python). Три режима: factor (свип), signal (событийный анализ), combine (комбинация).

import { FACTOR_BY_ID, supportsSkip, type FactorId, type Side, type SignalDef } from './factors';

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function clampNum(v: unknown, dflt: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

// Вселенную НЕ подставляем по умолчанию — её выбирает пользователь целенаправленно.
// Пустой/невалидный список → пустая вселенная (движок вернёт понятную ошибку «мало данных»).
function normUniverse(raw: unknown, benchmark: string, max: number): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [
    ...new Set(
      arr
        .map((s) => String(s).toUpperCase().trim())
        .filter((s) => TICKER.test(s) && s !== benchmark),
    ),
  ].slice(0, max);
}

function normNumberList(raw: unknown, fallback: number[], max: number, min = -1e6, hi = 1e6): number[] {
  const arr = Array.isArray(raw) ? raw : fallback;
  const out = [...new Set(arr.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= min && x <= hi))];
  out.sort((a, b) => a - b);
  return (out.length ? out : fallback).slice(0, max);
}

// Группы вселенной (для раздельных таблиц по классам активов в режиме factor).
function normGroups(raw: unknown, benchmark: string): { label: string; tickers: string[] }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; tickers: string[] }[] = [];
  for (const g of raw.slice(0, 8)) {
    const gg = g as any;
    const label = typeof gg?.label === 'string' && gg.label.trim() ? gg.label.trim().slice(0, 60) : 'Группа';
    const tickers = normUniverse(gg?.tickers, benchmark, 100);
    if (tickers.length) out.push({ label, tickers });
  }
  return out;
}

function normSignal(raw: any): SignalDef | null {
  const f = FACTOR_BY_ID[String(raw?.factor)];
  if (!f) return null;
  const param = f.paramOptions.includes(Number(raw?.param)) ? Number(raw.param) : f.defaultParams[0];
  const side: Side = raw?.side === 'low' || raw?.side === 'high' || raw?.side === 'band' ? raw.side : f.defaultSide;
  const skip = supportsSkip(f.id)
    ? Math.round(clampNum(raw?.skip, 0, 0, Math.max(0, param - 1)))
    : 0;
  if (side === 'band') {
    let lo = clampNum(raw?.lo, f.defaultThresholds[0], -1e6, 1e6);
    let hi = clampNum(raw?.hi, f.defaultThresholds[f.defaultThresholds.length - 1], -1e6, 1e6);
    if (lo > hi) [lo, hi] = [hi, lo];
    return { factor: f.id as FactorId, param, side, lo, hi, skip };
  }
  const threshold = clampNum(raw?.threshold, f.defaultThresholds[0], -1e6, 1e6);
  return { factor: f.id as FactorId, param, side, threshold, skip };
}

export type StudyConfig = Record<string, unknown> & { mode: 'factor' | 'signal' | 'combine' };

export function normalizeStudyConfig(body: any): StudyConfig {
  const mode = ['factor', 'signal', 'combine'].includes(body?.mode) ? body.mode : 'factor';
  const benchmark = (typeof body?.benchmark === 'string' && body.benchmark.trim() ? body.benchmark : 'SPY')
    .toUpperCase()
    .trim();
  const universe = normUniverse(body?.universe, benchmark, 200);
  const horizon = Math.round(clampNum(body?.horizon, 5, 1, 63));
  const dre = /^\d{4}-\d{2}-\d{2}/;
  const start = typeof body?.start === 'string' && dre.test(body.start) ? body.start.slice(0, 10) : undefined;
  const end = typeof body?.end === 'string' && dre.test(body.end) ? body.end.slice(0, 10) : undefined;
  const base: StudyConfig = { mode, benchmark, universe, horizon, start, end };

  if (mode === 'factor') {
    const f = FACTOR_BY_ID[String(body?.factor)] || FACTOR_BY_ID.xbench;
    // Свип всегда односторонний (high/low); диапазоны строит режим bins='range' из тех же порогов.
    const side: Side = body?.side === 'low' ? 'low' : body?.side === 'high' ? 'high' : f.defaultSide === 'low' ? 'low' : 'high';
    const params = normNumberList(body?.params, f.defaultParams, 6).filter((p) => f.paramOptions.includes(p));
    // Раздельные таблицы по классам активов: каждая выбранная группа считается отдельно.
    const groups = normGroups(body?.groups, benchmark);
    const factorUniverse = groups.length
      ? [...new Set(groups.flatMap((g) => g.tickers))].slice(0, 200)
      : universe;
    return {
      ...base,
      universe: factorUniverse,
      factor: f.id,
      side,
      bins: body?.bins === 'range' ? 'range' : 'cumulative',
      params: params.length ? params : f.defaultParams,
      thresholds: normNumberList(body?.thresholds, f.defaultThresholds, 14),
      fdrAlpha: clampNum(body?.fdrAlpha, 0.1, 0.01, 0.5),
      skip: Math.round(clampNum(body?.skip, 0, 0, 60)),
      groups: groups.length ? groups : undefined,
    };
  }

  if (mode === 'signal') {
    const sig = normSignal(body?.signal) || { factor: 'momentum', param: 5, side: 'low', threshold: -5 };
    return { ...base, signal: sig };
  }

  // combine
  const rawSignals = Array.isArray(body?.signals) ? body.signals : [];
  const signals = rawSignals.map(normSignal).filter((x: SignalDef | null) => x != null).slice(0, 3) as SignalDef[];
  const f0 = signals[0] ? FACTOR_BY_ID[signals[0].factor] : FACTOR_BY_ID.xbench;
  const f1 = signals[1] ? FACTOR_BY_ID[signals[1].factor] : FACTOR_BY_ID.vol;
  return {
    ...base,
    signals,
    grid0: normNumberList(body?.grid0, f0.defaultThresholds, 8),
    grid1: normNumberList(body?.grid1, f1.defaultThresholds, 8),
    minN: Math.round(clampNum(body?.minN, 30, 5, 5000)),
    folds: Math.round(clampNum(body?.folds, 4, 2, 8)),
  };
}
