import {
  ASSET_CLASSES,
  ASSET_CLASS_LABEL,
  DEFAULT_LIQUIDITY,
  type AssetClass,
  type LiquidityTier,
} from './types';

export type HoldingRow = {
  id: number;
  quarter: string;
  assetClass: string;
  name: string;
  symbol: string | null;
  quantity: number | null;
  value: number;
  costBasis: number | null;
  liquidityTier: string | null;
};

export type CashflowRow = {
  quarter: string;
  type: string; // contribution | withdrawal | income
  assetClass: string | null;
  amount: number;
};

export type SegmentMetaRow = {
  assetClass: string;
  targetPct: number | null;
  lastValuedAt: string | null;
  benchmark: string | null;
};

export type OverviewData = {
  quarters: string[];
  latestQuarter: string | null;
  netWorth: number;
  series: { quarter: string; value: number }[];
  deltas: { qoq: number | null; yoy: number | null; sinceStartAbs: number; sinceStartQuarter: string | null };
  allocation: { assetClass: AssetClass; label: string; value: number; pct: number }[];
  bridge: {
    startQuarter: string | null;
    endQuarter: string | null;
    startValue: number;
    endValue: number;
    steps: { assetClass: AssetClass; label: string; delta: number }[];
  };
  kpis: { twrYoY: number | null; mwrYoY: number | null; netContributions: number; income: number };
  modules: {
    assetClass: AssetClass;
    label: string;
    value: number;
    positions: number;
    qoqPct: number | null;
    unrealizedPnl: number | null;
  }[];
  liquidity: { tier: LiquidityTier; label: string; cumulativeValue: number; cumulativePct: number }[];
  alerts: { level: 'danger' | 'warning' | 'info'; badge: string; title: string; desc: string }[];
};

const TIER_LABEL: Record<LiquidityTier, string> = {
  t0: 'T+0 · cash',
  t7: 'T+7 · public',
  t90: 'T+90 · +crypto',
  locked: 'Locked · RE+PE',
};
const TIER_ORDER: LiquidityTier[] = ['t0', 't7', 't90', 'locked'];

function asClass(v: string): AssetClass {
  return (ASSET_CLASSES as string[]).includes(v) ? (v as AssetClass) : 'public';
}

function sumValues(rows: HoldingRow[]): number {
  return rows.reduce((s, h) => s + (h.value || 0), 0);
}

export function computeOverview(
  holdings: HoldingRow[],
  cashflows: CashflowRow[],
  meta: SegmentMetaRow[],
): OverviewData {
  const quarters = Array.from(new Set(holdings.map((h) => h.quarter))).sort();
  const latestQuarter = quarters.length ? quarters[quarters.length - 1] : null;

  const series = quarters.map((q) => ({
    quarter: q,
    value: sumValues(holdings.filter((h) => h.quarter === q)),
  }));
  const netWorth = latestQuarter ? series[series.length - 1].value : 0;

  // --- deltas ---
  const idxLatest = quarters.length - 1;
  const prevValue = idxLatest >= 1 ? series[idxLatest - 1].value : null;
  const yearAgoIdx = idxLatest - 4;
  const yearAgoValue = yearAgoIdx >= 0 ? series[yearAgoIdx].value : null;
  const startValue = series.length ? series[0].value : 0;
  const deltas = {
    qoq: prevValue && prevValue !== 0 ? ((netWorth - prevValue) / prevValue) * 100 : null,
    yoy: yearAgoValue && yearAgoValue !== 0 ? ((netWorth - yearAgoValue) / yearAgoValue) * 100 : null,
    sinceStartAbs: netWorth - startValue,
    sinceStartQuarter: quarters.length ? quarters[0] : null,
  };

  // --- allocation (latest) ---
  const latestHoldings = latestQuarter ? holdings.filter((h) => h.quarter === latestQuarter) : [];
  const allocation = ASSET_CLASSES.map((ac) => {
    const value = sumValues(latestHoldings.filter((h) => asClass(h.assetClass) === ac));
    return { assetClass: ac, label: ASSET_CLASS_LABEL[ac], value, pct: netWorth ? (value / netWorth) * 100 : 0 };
  })
    .filter((a) => a.value > 0)
    .sort((a, b) => b.value - a.value);

  // --- P&L bridge: первый -> последний квартал, дельта по классам ---
  const bStart = quarters.length ? quarters[0] : null;
  const startHoldings = bStart ? holdings.filter((h) => h.quarter === bStart) : [];
  const bridgeSteps = ASSET_CLASSES.map((ac) => {
    const s = sumValues(startHoldings.filter((h) => asClass(h.assetClass) === ac));
    const e = sumValues(latestHoldings.filter((h) => asClass(h.assetClass) === ac));
    return { assetClass: ac, label: ASSET_CLASS_LABEL[ac], delta: e - s };
  }).filter((s) => Math.abs(s.delta) > 0.005);

  // --- KPIs (последний квартал + годовые приближения) ---
  const cfLatest = latestQuarter ? cashflows.filter((c) => c.quarter === latestQuarter) : [];
  const netContributions =
    sumByType(cfLatest, 'contribution') - sumByType(cfLatest, 'withdrawal');
  const income = sumByType(cfLatest, 'income');
  const twrYoY = computeTwrYoY(series, quarters, cashflows);
  const mwrYoY = computeMwrYoY(series, quarters, cashflows, yearAgoIdx);

  // --- modules (per class, latest) ---
  const modules = ASSET_CLASSES.map((ac) => {
    const cur = latestHoldings.filter((h) => asClass(h.assetClass) === ac);
    const value = sumValues(cur);
    const prevQ = idxLatest >= 1 ? quarters[idxLatest - 1] : null;
    const prevVal = prevQ
      ? sumValues(holdings.filter((h) => h.quarter === prevQ && asClass(h.assetClass) === ac))
      : null;
    const cost = cur.reduce((s, h) => s + (h.costBasis ?? 0), 0);
    const hasCost = cur.some((h) => h.costBasis != null);
    return {
      assetClass: ac,
      label: ASSET_CLASS_LABEL[ac],
      value,
      positions: cur.length,
      qoqPct: prevVal && prevVal !== 0 ? ((value - prevVal) / prevVal) * 100 : null,
      unrealizedPnl: hasCost ? value - cost : null,
    };
  }).filter((m) => m.value > 0 || m.positions > 0);

  // --- liquidity (cumulative tiers) ---
  const tierValue: Record<LiquidityTier, number> = { t0: 0, t7: 0, t90: 0, locked: 0 };
  for (const h of latestHoldings) {
    const tier = (h.liquidityTier as LiquidityTier) || DEFAULT_LIQUIDITY[asClass(h.assetClass)];
    tierValue[tier] += h.value || 0;
  }
  let cum = 0;
  const liquidity = TIER_ORDER.map((tier) => {
    cum += tierValue[tier];
    return {
      tier,
      label: TIER_LABEL[tier],
      cumulativeValue: cum,
      cumulativePct: netWorth ? (cum / netWorth) * 100 : 0,
    };
  });

  const alerts = buildAlerts({ allocation, netWorth, modules, meta, latestQuarter });

  return {
    quarters,
    latestQuarter,
    netWorth,
    series,
    deltas,
    allocation,
    bridge: {
      startQuarter: bStart,
      endQuarter: latestQuarter,
      startValue,
      endValue: netWorth,
      steps: bridgeSteps,
    },
    kpis: { twrYoY, mwrYoY, netContributions, income },
    modules,
    liquidity,
    alerts,
  };
}

function sumByType(cf: CashflowRow[], type: string): number {
  return cf.filter((c) => c.type === type).reduce((s, c) => s + Math.abs(c.amount), 0);
}

// Modified-Dietz поквартальная доходность, скомпонованная за 4 последних квартала (TWR-приближение).
function computeTwrYoY(
  series: { quarter: string; value: number }[],
  quarters: string[],
  cashflows: CashflowRow[],
): number | null {
  if (series.length < 2) return null;
  const start = Math.max(1, series.length - 4);
  let factor = 1;
  let any = false;
  for (let i = start; i < series.length; i++) {
    const v0 = series[i - 1].value;
    const v1 = series[i].value;
    if (v0 <= 0) continue;
    const cf = cashflows.filter((c) => c.quarter === quarters[i]);
    const net = sumByType(cf, 'contribution') - sumByType(cf, 'withdrawal');
    const r = (v1 - v0 - net) / v0;
    factor *= 1 + r;
    any = true;
  }
  return any ? (factor - 1) * 100 : null;
}

// MWR-приближение (modified Dietz) за последний год: учитывает средневзвешенный капитал.
function computeMwrYoY(
  series: { quarter: string; value: number }[],
  quarters: string[],
  cashflows: CashflowRow[],
  yearAgoIdx: number,
): number | null {
  if (yearAgoIdx < 0 || series.length < 2) return null;
  const v0 = series[yearAgoIdx].value;
  const v1 = series[series.length - 1].value;
  if (v0 <= 0) return null;
  let netFlow = 0;
  let weighted = 0;
  const span = series.length - 1 - yearAgoIdx;
  for (let i = yearAgoIdx + 1; i < series.length; i++) {
    const cf = cashflows.filter((c) => c.quarter === quarters[i]);
    const net = sumByType(cf, 'contribution') - sumByType(cf, 'withdrawal');
    netFlow += net;
    const w = (series.length - 1 - i + 0.5) / span;
    weighted += net * w;
  }
  const denom = v0 + weighted;
  if (denom === 0) return null;
  return ((v1 - v0 - netFlow) / denom) * 100;
}

function buildAlerts(args: {
  allocation: OverviewData['allocation'];
  netWorth: number;
  modules: OverviewData['modules'];
  meta: SegmentMetaRow[];
  latestQuarter: string | null;
}): OverviewData['alerts'] {
  const alerts: OverviewData['alerts'] = [];
  const { allocation, modules, meta } = args;

  // 1. Тонкая кэш-подушка (< 5% — типовой минимум HNW).
  const cash = allocation.find((a) => a.assetClass === 'cash');
  const cashPct = cash?.pct ?? 0;
  if (cashPct < 5) {
    alerts.push({
      level: 'warning',
      badge: 'warning',
      title: `Кэш-подушка ${cashPct.toFixed(1)}% — ниже типового минимума HNW 5–10%`,
      desc: 'При просадке рынков потребуется ликвидация позиций для покрытия расходов.',
    });
  }

  // 2. Резкая просадка сегмента QoQ.
  for (const m of modules) {
    if (m.qoqPct != null && m.qoqPct <= -15) {
      alerts.push({
        level: 'info',
        badge: 'insight',
        title: `${m.label}: ${m.qoqPct.toFixed(0)}% QoQ — заметная просадка`,
        desc: 'Стоит проверить состав позиций сегмента.',
      });
    }
  }

  // 3. Устаревшая оценка сегмента (> 60 дней) из segment_meta.
  const now = Date.now();
  for (const sm of meta) {
    if (!sm.lastValuedAt) continue;
    const days = Math.floor((now - new Date(sm.lastValuedAt).getTime()) / 86400000);
    if (days > 60) {
      const label = ASSET_CLASS_LABEL[asClass(sm.assetClass)] ?? sm.assetClass;
      alerts.push({
        level: 'warning',
        badge: 'reminder',
        title: `Оценка «${label}» не обновлялась ${days} дней`,
        desc: 'Стоит обновить оценку до закрытия следующего квартала.',
      });
    }
  }

  // 4. Отклонение от целевой аллокации.
  for (const sm of meta) {
    if (sm.targetPct == null) continue;
    const a = allocation.find((x) => x.assetClass === asClass(sm.assetClass));
    const actual = a?.pct ?? 0;
    if (Math.abs(actual - sm.targetPct) >= 10) {
      const label = ASSET_CLASS_LABEL[asClass(sm.assetClass)] ?? sm.assetClass;
      alerts.push({
        level: 'info',
        badge: 'rebalance',
        title: `${label}: ${actual.toFixed(0)}% против цели ${sm.targetPct.toFixed(0)}%`,
        desc: 'Отклонение от целевой аллокации ≥ 10 пунктов — кандидат на ребаланс.',
      });
    }
  }

  return alerts;
}
