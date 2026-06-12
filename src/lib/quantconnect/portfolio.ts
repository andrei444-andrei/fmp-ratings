// Сборка матрицы портфеля: для каждого алгоритма тянем кривую капитала бектеста,
// считаем годовые метрики (+ бенчмарк), агрегируем по годам. Ошибки изолированы
// по алгоритму — один сбойный алгоритм не валит всю матрицу. Тяжёлые расчёты
// кэшируются по backtestId (неизменен).

import { listAlgorithms } from './algorithms';
import { qcListBacktests, qcReadSeries } from './client';
import { computeYearly, monthlyEquity } from './metrics';
import { qcCacheGet, qcCacheSet } from './cache';
import type { AlgoColumn, BenchmarkColumn, MonthPoint, PortfolioResponse, SeriesResponse, YearMetric } from './types';

function createdMs(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const n = Number(v);
  if (isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
  const d = Date.parse(v);
  return isFinite(d) ? d : 0;
}

// Резолвим конкретный backtestId: либо сохранённый, либо последний завершённый.
async function resolveBacktestId(projectId: string, stored: string | null): Promise<string | null> {
  if (stored) return stored;
  const list = await qcListBacktests(projectId);
  if (!list.length) return null;
  const completed = list.filter(b => b.completed);
  const pool = completed.length ? completed : list;
  pool.sort((a, b) => createdMs(b.created) - createdMs(a.created));
  return pool[0]?.backtestId || null;
}

type BacktestMetrics = {
  strategy: YearMetric[];
  benchmark: YearMetric[] | null;
  points: number;
  monthlyStrategy: MonthPoint[];
  monthlyBenchmark: MonthPoint[] | null;
};

async function metricsForBacktest(projectId: string, backtestId: string, force: boolean): Promise<BacktestMetrics> {
  // v2: в кэш добавлены месячные ряды — старые записи (без них) не подходят.
  const key = `bt|v2|${projectId}|${backtestId}`;
  if (!force) {
    const cached = await qcCacheGet<BacktestMetrics>(key);
    if (cached && cached.monthlyStrategy) return cached;
  }
  const equity = await qcReadSeries(projectId, backtestId, 'Strategy Equity', 'Equity');
  const strategy = computeYearly(equity);
  const monthlyStrategy = monthlyEquity(equity);

  let benchmark: YearMetric[] | null = null;
  let monthlyBenchmark: MonthPoint[] | null = null;
  try {
    const bench = await qcReadSeries(projectId, backtestId, 'Benchmark', 'Benchmark');
    if (bench.length) { benchmark = computeYearly(bench); monthlyBenchmark = monthlyEquity(bench); }
  } catch {
    benchmark = null;
  }

  const payload: BacktestMetrics = { strategy, benchmark, points: equity.length, monthlyStrategy, monthlyBenchmark };
  if (strategy.length) await qcCacheSet(key, payload);
  return payload;
}

function lastCumulative(years: YearMetric[]): number | null {
  // years отсортированы по возрастанию → накопительная последнего = итог.
  for (let i = years.length - 1; i >= 0; i--) {
    if (years[i].cumulative != null) return years[i].cumulative;
  }
  return null;
}

export async function buildPortfolio(force = false, includeArchived = false): Promise<PortfolioResponse> {
  const all = await listAlgorithms();
  // Статус фильтрует анализ: архив по умолчанию скрыт (экономит и вызовы к QC).
  const algos = includeArchived ? all : all.filter(a => a.status !== 'archive');

  const results = await Promise.all(
    algos.map(async a => {
      try {
        const backtestId = await resolveBacktestId(a.projectId, a.backtestId);
        if (!backtestId) return { a, backtestId: null as string | null, m: null as BacktestMetrics | null, error: 'в проекте нет бектестов' };
        const m = await metricsForBacktest(a.projectId, backtestId, force);
        return { a, backtestId, m, error: null as string | null };
      } catch (e: any) {
        return { a, backtestId: null as string | null, m: null as BacktestMetrics | null, error: e?.message || String(e) };
      }
    }),
  );

  const cols: AlgoColumn[] = [];
  let benchmark: BenchmarkColumn | null = null;

  for (const r of results) {
    const years: Record<number, YearMetric> = {};
    if (r.m) {
      for (const y of r.m.strategy) years[y.year] = y;
      // Бенчмарк берём из первого алгоритма, где он есть.
      if (!benchmark && r.m.benchmark && r.m.benchmark.length) {
        const byYear: Record<number, YearMetric> = {};
        for (const y of r.m.benchmark) byYear[y.year] = y;
        benchmark = { name: 'Бенчмарк', years: byYear, totalReturn: lastCumulative(r.m.benchmark) };
      }
    }
    cols.push({
      id: r.a.id,
      name: r.a.name,
      projectId: r.a.projectId,
      backtestId: r.a.backtestId,
      resolvedBacktestId: r.backtestId,
      status: r.a.status,
      description: r.a.description,
      error: r.error,
      years,
      totalReturn: r.m ? lastCumulative(r.m.strategy) : null,
      pointCount: r.m?.points ?? 0,
    });
  }

  const yset = new Set<number>();
  for (const c of cols) for (const y of Object.keys(c.years)) yset.add(Number(y));
  if (benchmark) for (const y of Object.keys(benchmark.years)) yset.add(Number(y));
  const years = [...yset].sort((a, b) => a - b);

  return { years, algos: cols, benchmark };
}

// Месячные ряды капитала стратегий (+ бенчмарк) — для объединённого портфеля.
// Переиспользует тот же кэш бектестов, что и матрица.
export async function buildSeries(force = false, includeArchived = false): Promise<SeriesResponse> {
  const all = await listAlgorithms();
  const algos = includeArchived ? all : all.filter(a => a.status !== 'archive');

  const results = await Promise.all(
    algos.map(async a => {
      try {
        const backtestId = await resolveBacktestId(a.projectId, a.backtestId);
        if (!backtestId) return { a, error: 'в проекте нет бектестов', m: null as BacktestMetrics | null };
        const m = await metricsForBacktest(a.projectId, backtestId, force);
        return { a, error: null as string | null, m };
      } catch (e: any) {
        return { a, error: e?.message || String(e), m: null as BacktestMetrics | null };
      }
    }),
  );

  let benchmark: { name: string; monthly: MonthPoint[] } | null = null;
  const outAlgos = results.map(r => {
    if (!benchmark && r.m?.monthlyBenchmark && r.m.monthlyBenchmark.length) {
      benchmark = { name: 'Бенчмарк', monthly: r.m.monthlyBenchmark };
    }
    return {
      id: r.a.id, name: r.a.name, status: r.a.status, error: r.error,
      monthly: r.m?.monthlyStrategy ?? [],
    };
  });

  return { algos: outAlgos, benchmark };
}
