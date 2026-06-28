// Волатильность и риск-режим (идея #5). Ядро — реализованная волатильность SPY и просадка
// от 52-нед максимума (надёжные данные из getPrices). VIX/VIX3M — опционально (если провайдер
// отдаёт ^VIX/^VIX3M), для уровня и терм-структуры (контанго/бэквардация). Snapshot-кэш (§6),
// graceful: нет ключей → синтетика + флаг.
import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { logAppError } from '@/lib/app-errors';
import { readSnapshot, writeSnapshot, isFresh } from './store';

const RISK_KEY = 'risk_v1';

export type VolPoint = { date: string; v: number };
export type RiskData = {
  asOf: string;
  vix: number | null;
  vixChg: number | null; // д/д, пункты
  vix3m: number | null;
  termRatio: number | null; // VIX/VIX3M: <1 контанго (спокойно), >1 бэквардация (стресс)
  realized21: number | null; // annualized %
  realized63: number | null;
  drawdown: number | null; // SPX от 52-нед максимума, %
  regime: 'спокойно' | 'настороже' | 'стресс';
  hist: VolPoint[]; // реализованная вол 21д за ~полгода
  synthetic: boolean;
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function loadCloses(sym: string, n = 320): Promise<{ closes: number[]; dates: string[]; synthetic: boolean }> {
  try {
    const rows = await getPrices(sym, isoDaysAgo(n), isoDaysAgo(0));
    if (rows && rows.length >= 30) return { closes: rows.map((r) => r.close), dates: rows.map((r) => r.date), synthetic: false };
  } catch {
    /* graceful */
  }
  const syn = syntheticSeries(sym, n);
  return { closes: syn.map((r) => r.close), dates: syn.map((r) => r.date), synthetic: true };
}

function annVol(rets: number[]): number | null {
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Реализованная вол за окно win как РЯД (последние ~points точек). */
function rollingVol(closes: number[], dates: string[], win = 21, points = 126): VolPoint[] {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    rets.push(a > 0 && b > 0 ? Math.log(b / a) : 0);
  }
  const out: VolPoint[] = [];
  const start = Math.max(win, rets.length - points);
  for (let i = start; i < rets.length; i++) {
    const v = annVol(rets.slice(i - win, i));
    if (v != null) out.push({ date: dates[i + 1] ?? dates[i], v });
  }
  return out;
}

async function lastTwo(sym: string): Promise<{ last: number | null; prev: number | null }> {
  try {
    const rows = await getPrices(sym, isoDaysAgo(20), isoDaysAgo(0));
    if (rows && rows.length >= 2) return { last: rows[rows.length - 1].close, prev: rows[rows.length - 2].close };
  } catch {
    /* нет такого символа у провайдера */
  }
  return { last: null, prev: null };
}

export async function computeRisk(): Promise<RiskData> {
  const spy = await loadCloses('SPY', 320);
  const rets = [] as number[];
  for (let i = 1; i < spy.closes.length; i++) {
    const a = spy.closes[i - 1];
    const b = spy.closes[i];
    rets.push(a > 0 && b > 0 ? Math.log(b / a) : 0);
  }
  const realized21 = annVol(rets.slice(-21));
  const realized63 = annVol(rets.slice(-63));
  // просадка от 52-нед максимума
  const win252 = spy.closes.slice(-252);
  const maxC = win252.length ? Math.max(...win252) : 0;
  const lastC = spy.closes[spy.closes.length - 1] ?? 0;
  const drawdown = maxC > 0 ? ((lastC - maxC) / maxC) * 100 : null;

  // VIX / VIX3M — опционально
  const [vixTwo, vix3mTwo] = await Promise.all([lastTwo('^VIX'), lastTwo('^VIX3M')]);
  const vix = vixTwo.last;
  const vixChg = vix != null && vixTwo.prev != null ? +(vix - vixTwo.prev).toFixed(2) : null;
  const vix3m = vix3mTwo.last;
  const termRatio = vix != null && vix3m != null && vix3m > 0 ? +(vix / vix3m).toFixed(3) : null;

  // режим: по VIX, иначе по реализованной 63д; бэквардация усиливает
  const gauge = vix ?? realized63 ?? 16;
  let regime: RiskData['regime'] = gauge < 16 ? 'спокойно' : gauge < 24 ? 'настороже' : 'стресс';
  if (termRatio != null && termRatio > 1) regime = 'стресс';

  return {
    asOf: spy.dates[spy.dates.length - 1] ?? isoDaysAgo(0),
    vix,
    vixChg,
    vix3m,
    termRatio,
    realized21,
    realized63,
    drawdown,
    regime,
    hist: rollingVol(spy.closes, spy.dates),
    synthetic: spy.synthetic,
  };
}

export async function getRisk(): Promise<RiskData> {
  const cached = await readSnapshot<RiskData>(RISK_KEY);
  if (cached && isFresh(cached.refreshedAt)) return cached.payload;
  try {
    const fresh = await computeRisk();
    await writeSnapshot(RISK_KEY, fresh, fresh.asOf);
    return fresh;
  } catch (e: any) {
    await logAppError({ route: '/api/market/risk', message: e?.message || 'risk failed', stack: e?.stack });
    if (cached) return cached.payload;
    throw e;
  }
}
