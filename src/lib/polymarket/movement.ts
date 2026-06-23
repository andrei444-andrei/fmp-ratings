// Детект смены закономерностей по почасовому ряду подразумеваемой вероятности
// рынка Polymarket (CLOB prices-history). Считаем сдвиги за разные окна,
// слом тренда (разворот), ускорение и всплеск волатильности.

export type HistPoint = { t: number; p: number };

export type Movement = {
  // изменения вероятности (в долях, не %) за окна
  d6h: number;
  d24h: number;
  d3d: number;
  d7d: number;
  d30d: number;
  // характеристики «слома закономерности»
  breakScore: number;   // 0..1: насколько недавний темп разошёлся с предыдущим
  accel: number;        // |движение за 24ч| − средний дневной темп за неделю (>0 = ускорение)
  reversal: boolean;    // последний день развернул направление прошлой недели
  volSpike: boolean;    // последние сутки волатильнее обычного (z >= 2.5)
  direction: -1 | 0 | 1; // знак движения за 24ч
  points: number;
  spark: number[];      // прорежённый ряд за ~7 дней для спарклайна
  daily: { t: number; p: number }[]; // по одному срезу на день (последние ~14 дней)
};

function pAtHoursAgo(h: HistPoint[], hours: number): number {
  if (!h.length) return NaN;
  const target = h[h.length - 1].t - hours * 3600;
  // ряд по возрастанию t — берём ближайшую точку не позже target (или самую раннюю)
  let chosen = h[0];
  for (const pt of h) {
    if (pt.t <= target) chosen = pt;
    else break;
  }
  return chosen.p;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function downsample(h: HistPoint[], maxPoints: number): number[] {
  if (h.length <= maxPoints) return h.map((p) => p.p);
  const step = h.length / maxPoints;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(h[Math.floor(i * step)].p);
  out.push(h[h.length - 1].p);
  return out;
}

const sign = (x: number): -1 | 0 | 1 => (x > 1e-9 ? 1 : x < -1e-9 ? -1 : 0);

// По одному срезу вероятности на календарный день (UTC) — последняя точка дня.
// Возвращает последние `days` дней в хронологическом порядке.
function dailySamples(h: HistPoint[], days: number): { t: number; p: number }[] {
  const byDay = new Map<string, HistPoint>();
  for (const pt of h) {
    const key = new Date(pt.t * 1000).toISOString().slice(0, 10);
    byDay.set(key, pt); // h отсортирован по возрастанию → останется последняя точка дня
  }
  return Array.from(byDay.values()).slice(-days);
}

export function computeMovement(raw: HistPoint[]): Movement | null {
  const h = (raw || []).filter((p) => Number.isFinite(p.p) && Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (h.length < 6) return null;

  const last = h[h.length - 1].p;
  const d6h = last - pAtHoursAgo(h, 6);
  const d24h = last - pAtHoursAgo(h, 24);
  const d3d = last - pAtHoursAgo(h, 72);
  const d7d = last - pAtHoursAgo(h, 168);
  const d30d = last - pAtHoursAgo(h, 720);

  // движение за предыдущие дни 7..1 (то, что было ДО последних суток)
  const priorWeekMove = pAtHoursAgo(h, 24) - pAtHoursAgo(h, 168);

  // темпы в день: последние сутки vs средний за предыдущие 6 дней
  const recentRate = d24h; // за день
  const priorRate = priorWeekMove / 6; // средн. за день в течение прошлой недели
  // breakScore — нормированное расхождение темпов (на сколько «поломался» прежний паттерн)
  const breakScore = clamp01(Math.abs(recentRate - priorRate) / 0.15);

  const avgDailyWeek = Math.abs(d7d) / 7;
  const accel = Math.abs(d24h) - avgDailyWeek;

  const reversal =
    sign(d24h) !== 0 && sign(priorWeekMove) !== 0 && sign(d24h) !== sign(priorWeekMove) && Math.abs(d24h) >= 0.03;

  // всплеск волатильности: |почасовые приращения| последних 24ч против базовой std
  const diffs: number[] = [];
  for (let i = 1; i < h.length; i++) diffs.push(Math.abs(h[i].p - h[i - 1].p));
  const recent = diffs.slice(-24);
  const base = diffs.slice(0, Math.max(0, diffs.length - 24));
  let volSpike = false;
  if (base.length >= 12 && recent.length) {
    const mean = base.reduce((a, b) => a + b, 0) / base.length;
    const variance = base.reduce((a, b) => a + (b - mean) * (b - mean), 0) / base.length;
    const std = Math.sqrt(variance) || 1e-6;
    const recentMax = Math.max(...recent);
    volSpike = (recentMax - mean) / std >= 2.5 && recentMax >= 0.02;
  }

  return {
    d6h, d24h, d3d, d7d, d30d,
    breakScore, accel, reversal, volSpike,
    direction: sign(d24h),
    points: h.length,
    spark: downsample(h.filter((p) => p.t >= h[h.length - 1].t - 7 * 86400), 48),
    daily: dailySamples(h, 14),
  };
}

// Величина движения за выбранное окно (для ранжирования «сдвигов»).
export function windowDelta(m: Movement, win: '24h' | '3d' | '7d'): number {
  return win === '24h' ? m.d24h : win === '3d' ? m.d3d : m.d7d;
}
