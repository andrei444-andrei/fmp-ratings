// Нормализация/валидация конфига исследования (недоверенный ввод с клиента → безопасный объект
// для Python). Три режима: factor (свип), signal (событийный анализ), combine (комбинация).

import { FACTOR_BY_ID, type FactorId, type Side, type SignalDef } from './factors';
import { UNIVERSE_PRESETS } from './presets';

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const BROAD = UNIVERSE_PRESETS.find((p) => p.id === 'broad')!.tickers;

function clampNum(v: unknown, dflt: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function normUniverse(raw: unknown, benchmark: string, max: number): string[] {
  const arr = Array.isArray(raw) ? raw : BROAD;
  const set = [
    ...new Set(
      arr
        .map((s) => String(s).toUpperCase().trim())
        .filter((s) => TICKER.test(s) && s !== benchmark),
    ),
  ].slice(0, max);
  return set.length ? set : BROAD.filter((t) => t !== benchmark);
}

function normNumberList(raw: unknown, fallback: number[], max: number, min = -1e6, hi = 1e6): number[] {
  const arr = Array.isArray(raw) ? raw : fallback;
  const out = [...new Set(arr.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= min && x <= hi))];
  out.sort((a, b) => a - b);
  return (out.length ? out : fallback).slice(0, max);
}

function normSignal(raw: any): SignalDef | null {
  const f = FACTOR_BY_ID[String(raw?.factor)];
  if (!f) return null;
  const param = f.paramOptions.includes(Number(raw?.param)) ? Number(raw.param) : f.defaultParams[0];
  const side: Side = raw?.side === 'low' || raw?.side === 'high' ? raw.side : f.defaultSide;
  const threshold = clampNum(raw?.threshold, f.defaultThresholds[0], -1e6, 1e6);
  return { factor: f.id as FactorId, param, side, threshold };
}

export type StudyConfig = Record<string, unknown> & { mode: 'factor' | 'signal' | 'combine' };

export function normalizeStudyConfig(body: any): StudyConfig {
  const mode = ['factor', 'signal', 'combine'].includes(body?.mode) ? body.mode : 'factor';
  const benchmark = (typeof body?.benchmark === 'string' && body.benchmark.trim() ? body.benchmark : 'SPY')
    .toUpperCase()
    .trim();
  const universe = normUniverse(body?.universe, benchmark, 200);
  const horizon = Math.round(clampNum(body?.horizon, 5, 1, 63));
  const base: StudyConfig = { mode, benchmark, universe, horizon };

  if (mode === 'factor') {
    const f = FACTOR_BY_ID[String(body?.factor)] || FACTOR_BY_ID.xbench;
    const side: Side = body?.side === 'low' || body?.side === 'high' ? body.side : f.defaultSide;
    const params = normNumberList(body?.params, f.defaultParams, 6).filter((p) => f.paramOptions.includes(p));
    return {
      ...base,
      factor: f.id,
      side,
      params: params.length ? params : f.defaultParams,
      thresholds: normNumberList(body?.thresholds, f.defaultThresholds, 14),
      fdrAlpha: clampNum(body?.fdrAlpha, 0.1, 0.01, 0.5),
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
