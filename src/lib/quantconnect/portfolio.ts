// Сборка матрицы портфеля: для каждого алгоритма тянем кривую капитала бектеста,
// считаем годовые метрики (+ бенчмарк), агрегируем по годам. Ошибки изолированы
// по алгоритму — один сбойный алгоритм не валит всю матрицу. Тяжёлые расчёты
// кэшируются по backtestId (неизменен).

import { listAlgorithms } from './algorithms';
import { qcListBacktests, qcReadSeries } from './client';
import { computeYearly, dailySeries } from './metrics';
import { qcCacheGet, qcCacheSet } from './cache';
import { getSpyBenchmark } from './benchmark';
import type { AlgoColumn, BenchmarkColumn, DayPoint, PortfolioResponse, SeriesResponse, YearMetric } from './types';

function createdMs(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const n = Number(v);
  if (isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
  const d = Date.parse(v);
  return isFinite(d) ? d : 0;
}

// Резолвим конкретный backtestId: либо сохранённый, либо последний завершённый.
export async function resolveBacktestId(projectId: string, stored: string | null): Promise<string | null> {
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
  dailyStrategy: DayPoint[];
  dailyBenchmark: DayPoint[] | null;
};

async function metricsForBacktest(projectId: string, backtestId: string, force: boolean): Promise<BacktestMetrics> {
  // v3: в кэше дневные ряды (для реальных просадок) — старые записи не подходят.
  const key = `bt|v3|${projectId}|${backtestId}`;
  if (!force) {
    const cached = await qcCacheGet<BacktestMetrics>(key);
    if (cached && cached.dailyStrategy) return cached;
  }
  const equity = await qcReadSeries(projectId, backtestId, 'Strategy Equity', 'Equity');
  const strategy = computeYearly(equity);
  const dailyStrategy = dailySeries(equity);

  let benchmark: YearMetric[] | null = null;
  let dailyBenchmark: DayPoint[] | null = null;
  try {
    const bench = await qcReadSeries(projectId, backtestId, 'Benchmark', 'Benchmark');
    if (bench.length) { benchmark = computeYearly(bench); dailyBenchmark = dailySeries(bench); }
  } catch {
    benchmark = null;
  }

  const payload: BacktestMetrics = { strategy, benchmark, points: equity.length, dailyStrategy, dailyBenchmark };
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

  // Бенчмарк — SPY (из FMP). Фолбэк на бенчмарк бектеста, если SPY недоступен.
  let benchmark: BenchmarkColumn | null = null;
  const spy = await getSpyBenchmark(force).catch(() => null);
  if (spy && spy.yearly.length) {
    const byYear: Record<number, YearMetric> = {};
    for (const y of spy.yearly) byYear[y.year] = y;
    benchmark = { name: spy.name, years: byYear, totalReturn: lastCumulative(spy.yearly) };
  }

  for (const r of results) {
    const years: Record<number, YearMetric> = {};
    if (r.m) {
      for (const y of r.m.strategy) years[y.year] = y;
      if (!benchmark && r.m.benchmark && r.m.benchmark.length) {
        const byYear: Record<number, YearMetric> = {};
        for (const y of r.m.benchmark) byYear[y.year] = y;
        benchmark = { name: 'Бенчмарк (бектест)', years: byYear, totalReturn: lastCumulative(r.m.benchmark) };
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

  // Годы матрицы — только из стратегий (бенчмарк SPY покрывает их с запасом,
  // иначе появились бы пустые годы без стратегий).
  const yset = new Set<number>();
  for (const c of cols) for (const y of Object.keys(c.years)) yset.add(Number(y));
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

  // Бенчмарк — SPY (из FMP); фолбэк на бенчмарк бектеста.
  let benchmark: { name: string; daily: DayPoint[] } | null = null;
  const spy = await getSpyBenchmark(force).catch(() => null);
  if (spy && spy.daily.length) benchmark = { name: spy.name, daily: spy.daily };

  const outAlgos = results.map(r => {
    if (!benchmark && r.m?.dailyBenchmark && r.m.dailyBenchmark.length) {
      benchmark = { name: 'Бенчмарк (бектест)', daily: r.m.dailyBenchmark };
    }
    return {
      id: r.a.id, name: r.a.name, status: r.a.status, error: r.error,
      daily: r.m?.dailyStrategy ?? [],
    };
  });

  return { algos: outAlgos, benchmark };
}

// Ad-hoc колонка для «Сравнения по годам»: годовые метрики произвольного
// projectId+backtestId БЕЗ добавления в портфель/БД. Переиспользует тот же кэш
// бектестов. id ставит клиент (синтетический), здесь — 0.
export async function buildPreviewColumn(projectId: string, backtestId: string | null, force = false): Promise<AlgoColumn> {
  const base = (extra: Partial<AlgoColumn>): AlgoColumn => ({
    id: 0, name: `Проект ${projectId}`, projectId, backtestId, resolvedBacktestId: null,
    status: 'active', description: null, error: null, years: {}, totalReturn: null, pointCount: 0, ...extra,
  });
  let resolved: string | null = null;
  let name = `Проект ${projectId}`;
  try {
    resolved = await resolveBacktestId(projectId, backtestId);
    if (resolved) {
      const list = await qcListBacktests(projectId).catch(() => []);
      const bt = list.find(b => b.backtestId === resolved);
      if (bt?.name) name = bt.name;
    }
  } catch (e: any) {
    return base({ name, error: e?.message || String(e) });
  }
  if (!resolved) return base({ name, error: 'в проекте нет бектестов' });
  try {
    let m = await metricsForBacktest(projectId, resolved, force);
    // пустая кривая капитала бывает транзиентной (chart/read ещё строится / лимит) —
    // ретраим минуя кэш, и только потом честно говорим, что данных нет.
    if (!m.strategy.length && !force) m = await metricsForBacktest(projectId, resolved, true);
    if (!m.strategy.length) {
      return base({ name, resolvedBacktestId: resolved,
        error: 'пустая кривая капитала (Strategy Equity): бектест ещё строится, без графика или лимит API. Выберите конкретный завершённый бектест и попробуйте ещё раз.' });
    }
    const years: Record<number, YearMetric> = {};
    for (const y of m.strategy) years[y.year] = y;
    return base({ name, resolvedBacktestId: resolved, years, totalReturn: lastCumulative(m.strategy), pointCount: m.points });
  } catch (e: any) {
    return base({ name, resolvedBacktestId: resolved, error: e?.message || String(e) });
  }
}
