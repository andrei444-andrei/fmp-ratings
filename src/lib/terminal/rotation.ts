// Ротация секторов (RRG, Relative Rotation Graph). Считается ТОЛЬКО из getPrices (наши цены),
// новых провайдеров не нужно. Для каждого сектора vs бенчмарк (SPY):
//   rel = close/bench; RS-Ratio = 100·rel/SMA(rel,W); RS-Momentum = 100·rsRatio/SMA(rsRatio,M).
// Квадранты вокруг 100: Лидеры (>100,>100), Слабеют (>100,<100), Отстают (<100,<100),
// Улучшаются (<100,>100). Хвост — последние недельные точки траектории. Snapshot-кэш (§6).
import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { logAppError } from '@/lib/app-errors';
import { instrumentDef, SEED_BLOCKS } from './registry';
import { readSnapshot, writeSnapshot, isFresh } from './store';

const BENCH = 'SPY';
const LOOKBACK_DAYS = 320; // ~250 торг. дней + запас
const EMA_REL = 8; // сглаживание относительной силы (убирает дневной шум)
const W_RATIO = 60; // окно нормализации RS-Ratio (торг. дни)
const EMA_RATIO = 8; // доп. сглаживание RS-Ratio → гладкие дуги
const W_MOM = 20; // окно момента RS-Ratio
const EMA_MOM = 5; // сглаживание момента
const TAIL_POINTS = 6; // недельных точек в хвосте
const TAIL_STEP = 5; // ~неделя

export type RotationPoint = { x: number; y: number };
export type RotationItem = {
  symbol: string;
  title: string;
  rsRatio: number;
  rsMomentum: number;
  quadrant: 'leading' | 'weakening' | 'lagging' | 'improving';
  tail: RotationPoint[]; // от старого к последнему (последний = текущее положение)
  ret63: number | null;
};
export type RotationData = {
  asOf: string;
  benchmark: string;
  window: number;
  items: RotationItem[];
  synthetic: boolean;
};

const ROTATION_KEY = 'rotation_v2'; // v2: EMA-сглаживание рядов (гладкие хвосты)

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Скользящее среднее как РЯД (выровнен по индексам, null пока окна не хватает). */
function smaSeries(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** EMA как РЯД той же длины (сглаживание шума → гладкие хвосты RRG). */
function emaSeries(xs: number[], n: number): number[] {
  const out: number[] = new Array(xs.length);
  const a = 2 / (n + 1);
  let prev = xs[0] ?? 0;
  for (let i = 0; i < xs.length; i++) {
    prev = i === 0 ? xs[i] : xs[i] * a + prev * (1 - a);
    out[i] = prev;
  }
  return out;
}

function quadrantOf(r: number, m: number): RotationItem['quadrant'] {
  if (r >= 100 && m >= 100) return 'leading';
  if (r >= 100 && m < 100) return 'weakening';
  if (r < 100 && m < 100) return 'lagging';
  return 'improving';
}

async function loadCloses(sym: string, from: string, to: string): Promise<{ map: Map<string, number>; synthetic: boolean }> {
  try {
    const rows = await getPrices(sym, from, to);
    if (rows && rows.length >= 60) return { map: new Map(rows.map((r) => [r.date, r.close])), synthetic: false };
  } catch {
    /* провайдер недоступен — синтетика */
  }
  const syn = syntheticSeries(sym, 340);
  return { map: new Map(syn.map((r) => [r.date, r.close])), synthetic: true };
}

/** Полный расчёт RRG. Тяжёлый — кэшируется снапшотом. */
export async function computeRotation(symbols?: string[]): Promise<RotationData> {
  const sectors = symbols && symbols.length ? symbols : (SEED_BLOCKS.find((b) => b.id === 'sectors_us')?.members ?? []);
  const from = isoDaysAgo(LOOKBACK_DAYS);
  const to = isoDaysAgo(0);

  const bench = await loadCloses(BENCH, from, to);
  let anySynthetic = bench.synthetic;
  const benchDates = [...bench.map.keys()].sort();

  const items: RotationItem[] = [];
  for (const sym of sectors) {
    try {
      const { map, synthetic } = await loadCloses(sym, from, to);
      if (synthetic) anySynthetic = true;
      // выравниваем по общим датам с бенчмарком
      const rel: number[] = [];
      const dates: string[] = [];
      for (const d of benchDates) {
        const c = map.get(d);
        const b = bench.map.get(d);
        if (c != null && b != null && b > 0) {
          rel.push(c / b);
          dates.push(d);
        }
      }
      if (rel.length < W_RATIO + W_MOM + TAIL_POINTS * TAIL_STEP) continue;
      // RS-Ratio: сглаженная относительная сила / её норма; затем доп. EMA для гладких дуг
      const relS = emaSeries(rel, EMA_REL);
      const smaRel = smaSeries(relS, W_RATIO);
      const ratioRaw = relS.map((v, i) => (smaRel[i] != null && smaRel[i]! > 0 ? 100 * (v / smaRel[i]!) : 100));
      const rsRatioSeries: (number | null)[] = emaSeries(ratioRaw, EMA_RATIO);
      // RS-Momentum: ускорение RS-Ratio относительно своей нормы (тоже сглажено)
      const ratioClean = rsRatioSeries.map((v) => (v == null ? 100 : v));
      const smaRatio = smaSeries(ratioClean, W_MOM);
      const momRaw = ratioClean.map((v, i) => (smaRatio[i] != null && smaRatio[i]! > 0 ? 100 * (v / smaRatio[i]!) : 100));
      const rsMomSeries: (number | null)[] = emaSeries(momRaw, EMA_MOM);

      // хвост — последние TAIL_POINTS точек с шагом TAIL_STEP
      const tail: RotationPoint[] = [];
      const lastIdx = rel.length - 1;
      for (let k = TAIL_POINTS - 1; k >= 0; k--) {
        const i = lastIdx - k * TAIL_STEP;
        if (i < 0) continue;
        const x = rsRatioSeries[i];
        const y = rsMomSeries[i];
        if (x != null && y != null) tail.push({ x, y });
      }
      if (tail.length < 2) continue;
      const cur = tail[tail.length - 1];

      // доходность за 63 дня
      let ret63: number | null = null;
      const closesArr = dates.map((d) => map.get(d)!);
      if (closesArr.length > 63) {
        const a = closesArr[closesArr.length - 64];
        const b = closesArr[closesArr.length - 1];
        if (a > 0) ret63 = ((b - a) / a) * 100;
      }

      items.push({
        symbol: sym,
        title: instrumentDef(sym)?.title ?? sym,
        rsRatio: cur.x,
        rsMomentum: cur.y,
        quadrant: quadrantOf(cur.x, cur.y),
        tail,
        ret63,
      });
    } catch (e: any) {
      await logAppError({ route: '/api/market/rotation', message: `rotation failed for ${sym}: ${e?.message || e}`, meta: { sym } });
    }
  }

  const asOf = benchDates[benchDates.length - 1] ?? to;
  return { asOf, benchmark: BENCH, window: W_RATIO, items, synthetic: anySynthetic };
}

/** Snapshot-first: тёплый снапшот мгновенно; иначе считаем, кэшируем и отдаём. */
export async function getRotation(): Promise<RotationData> {
  const cached = await readSnapshot<RotationData>(ROTATION_KEY);
  if (cached && isFresh(cached.refreshedAt)) return cached.payload;
  try {
    const fresh = await computeRotation();
    await writeSnapshot(ROTATION_KEY, fresh, fresh.asOf);
    return fresh;
  } catch (e: any) {
    if (cached) return cached.payload;
    throw e;
  }
}
