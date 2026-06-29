// Слой overview рыночного терминала. Фичи ходят ТОЛЬКО сюда (§6), не в провайдера.
// Кэш-первым через getPrices; per-symbol try/catch + синтетика → ошибка одного тикера
// не валит экран (graceful, §5). Snapshot-first: getOverview отдаёт тёплый снапшот мгновенно.
import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { fmpBatchQuote } from '@/lib/fmp';
import { logAppError } from '@/lib/app-errors';
import { computeInstrumentMetrics, dailyLogReturns, annualizedVol, correlation, type Bar } from './metrics';
import { computeBlockMetrics, averagePairwiseCorrelation, computeRegime } from './block-metrics';
import { SEED_BLOCKS, SEED_INSTRUMENTS, instrumentDef, allSymbols, effectiveBlocks } from './registry';
import { readSnapshot, writeSnapshot } from './store';
import { readConfig } from './config-store';
import type { BlockDef, InstrumentMetrics, MarketOverview, OverviewBlock } from './types';

const OVERVIEW_KEY = 'overview';
const LOOKBACK_DAYS = 400; // ~252 торговых + запас на праздники/MA200
const OVERVIEW_TTL_MS = 10 * 60 * 1000; // near-real-time: освежаем не реже раза в ~10 мин

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

type Quote = { chgPct: number; day: string };

/** Текущие котировки вселенной (FMP batch-quote) для near-real-time точки «сегодня».
 *  Graceful: нет ключа/эндпоинта → пустая карта → дашборд остаётся EOD. */
async function loadQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (!process.env.FMP_API_KEY) return out; // нет ключа (e2e/локально) — без live, остаёмся на EOD
  try {
    const rows = await fmpBatchQuote(symbols);
    for (const r of Array.isArray(rows) ? rows : []) {
      const sym = String(r?.symbol ?? '').toUpperCase();
      const chg = Number(r?.changePercentage ?? r?.changesPercentage);
      if (!sym || !Number.isFinite(chg)) continue;
      const ts = Number(r?.timestamp);
      const day = Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
      out.set(sym, { chgPct: chg, day });
    }
  } catch {
    /* нет ключа FMP / эндпоинт недоступен — работаем по EOD */
  }
  return out;
}

/** Подмешивает точку «сегодня» в ряд: к последнему скорр. close применяем дневной % из котировки.
 *  Так уровень согласован с adjusted-историей. Возвращает true, если точка добавлена. */
function spliceTodayQuote(bars: Bar[], q: Quote | undefined, today: string): boolean {
  if (!q || q.day !== today || bars.length === 0) return false;
  const last = bars[bars.length - 1];
  if (last.date >= today) return false; // сегодня уже есть в EOD — не дублируем
  const close = last.close * (1 + q.chgPct / 100);
  if (!Number.isFinite(close) || close <= 0) return false;
  bars.push({ date: today, close });
  return true;
}

async function loadBars(sym: string, from: string, to: string): Promise<{ bars: Bar[]; synthetic: boolean }> {
  try {
    const rows = await getPrices(sym, from, to);
    if (rows && rows.length >= 5) return { bars: rows.map((r) => ({ date: r.date, close: r.close })), synthetic: false };
  } catch (e: any) {
    // нет ключей/БД или сбой провайдера — падать нельзя, уходим в синтетику
  }
  const syn = syntheticSeries(sym, 420).map((r) => ({ date: r.date, close: r.close }));
  return { bars: syn, synthetic: true };
}

async function inChunks<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    out.push(...(await Promise.all(slice.map(fn))));
  }
  return out;
}

/** Полный расчёт overview по конфигу блоков. Тяжёлая операция — кэшируется снапшотом. */
export async function computeOverview(blocks: BlockDef[] = SEED_BLOCKS): Promise<MarketOverview> {
  const symbols = allSymbols(blocks);
  const from = isoDaysAgo(LOOKBACK_DAYS);
  const to = isoDaysAgo(0);
  const today = to;

  const metricsMap = new Map<string, InstrumentMetrics | null>();
  const retsMap = new Map<string, number[]>();
  const closesMap = new Map<string, number[]>();
  let anySynthetic = false;
  let live = false;

  const quoteMap = await loadQuotes(symbols);

  await inChunks(symbols, 6, async (sym) => {
    try {
      const { bars, synthetic } = await loadBars(sym, from, to);
      if (synthetic) anySynthetic = true;
      else if (spliceTodayQuote(bars, quoteMap.get(sym), today)) live = true;
      const m = computeInstrumentMetrics(bars);
      if (m) {
        m.symbol = sym;
        m.synthetic = synthetic;
      }
      metricsMap.set(sym, m);
      const closes = bars.map((b) => b.close);
      closesMap.set(sym, closes);
      retsMap.set(sym, dailyLogReturns(closes));
    } catch (e: any) {
      await logAppError({ route: '/api/market/overview', message: `metrics failed for ${sym}: ${e?.message || e}`, meta: { sym } });
      metricsMap.set(sym, null);
    }
  });

  // Сборка блоков
  const outBlocks: OverviewBlock[] = blocks.map((b) => {
    const benchM = b.benchmark ? metricsMap.get(b.benchmark) ?? null : null;
    const bench63 = benchM?.returns[63] ?? null;
    const cells = b.members.map((sym) => {
      const def = instrumentDef(sym) ?? { symbol: sym, title: sym, kind: 'etf' as const, currency: 'USD' };
      const metrics = metricsMap.get(sym) ?? null;
      if (metrics && bench63 != null && metrics.returns[63] != null) {
        metrics.excess63 = metrics.returns[63]! - bench63;
      }
      return { def, metrics };
    });
    const bm = computeBlockMetrics(cells.map((c) => c.metrics));
    // avgCorr по членам блока (optional без истории отсеются по длине рядов)
    bm.avgCorr = averagePairwiseCorrelation(b.members.map((s) => retsMap.get(s) ?? []));
    return { def: b, metrics: bm, instruments: cells };
  });

  // Глобальный режим
  const uniqMembers = [...new Set(blocks.flatMap((b) => b.members))];
  const universeRets = uniqMembers.map((s) => retsMap.get(s) ?? []);
  const avgCorr = averagePairwiseCorrelation(universeRets, 63);
  const breadth = pctAboveMA200(uniqMembers.map((s) => metricsMap.get(s) ?? null));
  const spyCloses = closesMap.get('SPY') ?? [];
  const volRegime = volRatio(spyCloses);
  const regime = computeRegime({ avgCorr, volRegime, breadth });

  const asOf = maxAsOf(metricsMap);
  const uniq = [...new Set(blocks.flatMap((b) => b.members))];
  const correlationMx = buildCorrelation(retsMap, uniq);
  return { asOf, blocks: outBlocks, regime, correlation: correlationMx, synthetic: anySynthetic, live };
}

// Полная кросс-ассет корреляция (63д) по ВСЕМ тикерам вселенной — клиент сам выбирает
// подмножество для матрицы (настраиваемый виджет). Матрица NxN, диагональ = 1.
function buildCorrelation(retsMap: Map<string, number[]>, members: string[]): MarketOverview['correlation'] {
  const symbols = members.filter((s) => (retsMap.get(s)?.length ?? 0) >= 20);
  if (symbols.length < 2) return null;
  const win = 63;
  const matrix = symbols.map((a) =>
    symbols.map((b) => {
      if (a === b) return 1;
      return correlation((retsMap.get(a) ?? []).slice(-win), (retsMap.get(b) ?? []).slice(-win));
    }),
  );
  return { symbols, titles: symbols.map((s) => instrumentDef(s)?.title ?? s), matrix, window: win };
}

function pctAboveMA200(ms: (InstrumentMetrics | null)[]): number | null {
  const flags = ms.map((m) => m?.aboveMA200 ?? null).filter((f): f is boolean => f != null);
  if (!flags.length) return null;
  return (flags.filter(Boolean).length / flags.length) * 100;
}
function volRatio(closes: number[]): number | null {
  const v21 = annualizedVol(closes, 21);
  const v252 = annualizedVol(closes, 252);
  return v21 != null && v252 != null && v252 !== 0 ? v21 / v252 : null;
}
function maxAsOf(m: Map<string, InstrumentMetrics | null>): string {
  let mx = '';
  for (const v of m.values()) if (v && v.asOf > mx) mx = v.asOf;
  return mx || isoDaysAgo(0);
}

/** Сигнатура блоков — меняется при правке состава/названия/набора виджетов → снапшот промахивается. */
function blocksSignature(blocks: BlockDef[]): string {
  return blocks.map((b) => `${b.id}:${b.title}:${b.members.join(',')}`).join('|');
}

/**
 * Snapshot-first: тёплый снапшот мгновенно; иначе считаем, кэшируем и отдаём.
 * Учитывает пользовательские переопределения состава блоков (config-store): при правке
 * виджета сигнатура меняется → кэш промахивается → пересчёт по новому составу.
 */
export async function getOverview(): Promise<MarketOverview> {
  const cfg = await readConfig();
  const blocks = effectiveBlocks(cfg);
  const sig = blocksSignature(blocks);
  const cached = await readSnapshot<MarketOverview>(OVERVIEW_KEY);
  if (cached && Date.now() - cached.refreshedAt < OVERVIEW_TTL_MS && cached.payload.cfgSig === sig) return cached.payload;
  try {
    const fresh = await computeOverview(blocks);
    fresh.cfgSig = sig;
    await writeSnapshot(OVERVIEW_KEY, fresh, fresh.asOf);
    return fresh;
  } catch (e: any) {
    if (cached) return cached.payload; // протухший лучше пустого
    throw e;
  }
}

export { SEED_INSTRUMENTS };
