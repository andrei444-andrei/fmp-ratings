'use client';

import { Fragment, type ReactNode } from 'react';
import type { PortfolioResponse, YearMetric } from '@/lib/quantconnect/types';

// Доля (0.123) → «+12.3%». Просадка отрицательная.
function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100;
  const s = p > 0 ? '+' : p < 0 ? '−' : '';
  return s + Math.abs(p).toFixed(digits) + '%';
}
// Без знака — для разброса (σ).
function fmtPctU(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return (v * 100).toFixed(digits) + '%';
}
function cls(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return 'qc-mut';
  return v > 0 ? 'qc-pos' : 'qc-neg';
}

type Stats = {
  avgRet: number | null; avgDD: number | null;
  stdRet: number | null; stdDD: number | null;
  best: number | null; worst: number | null;
  beat: number | null; compared: number | null;
  n: number;
};

// CAGR (среднегодовой геометрический рост) из накопительной за n лет.
function cagr(total: number | null, n: number | null | undefined): number | null {
  if (total == null || !isFinite(total) || total <= -1 || !n || n <= 0) return null;
  return Math.pow(1 + total, 1 / n) - 1;
}

// Агрегаты по годам: средние, разброс (σ), лучший/худший год, «лет лучше БМ».
function aggStats(yearsMap: Record<number, YearMetric>, years: number[], bench?: Record<number, YearMetric>): Stats {
  const rets: number[] = [], dds: number[] = [];
  let beat = 0, compared = 0;
  for (const y of years) {
    const m = yearsMap[y];
    if (!m) continue;
    if (m.ret != null && isFinite(m.ret)) rets.push(m.ret);
    if (m.maxDD != null && isFinite(m.maxDD)) dds.push(m.maxDD);
    if (bench && bench[y] && m.ret != null && bench[y].ret != null) {
      compared++;
      if (m.ret > (bench[y].ret as number)) beat++;
    }
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const std = (a: number[]) => {
    if (a.length < 2) return null;
    const m = avg(a) as number;
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  };
  return {
    avgRet: avg(rets), avgDD: avg(dds), stdRet: std(rets), stdDD: std(dds),
    best: rets.length ? Math.max(...rets) : null,
    worst: rets.length ? Math.min(...rets) : null,
    beat: bench ? beat : null, compared: bench ? compared : null,
    n: rets.length,
  };
}

// Тройка ячеек одной группы за год: просадка, доходность, накопительная.
// Ячейка доходности заливается зелёным/красным = обыграла/проиграла бенчмарк за год.
function TripleCells({ m, bench }: { m?: YearMetric; bench?: YearMetric }) {
  let retClass = m ? cls(m.ret) : 'qc-mut';
  if (m && bench && m.ret != null && bench.ret != null) {
    retClass = m.ret > bench.ret ? 'qc-beat' : m.ret < bench.ret ? 'qc-lag' : retClass;
  }
  const title = (m && bench && m.ret != null && bench.ret != null)
    ? `vs бенчмарк: ${fmtPct(m.ret - bench.ret)}` : undefined;
  return (
    <>
      <td className={'grp ' + (m ? cls(m.maxDD) : 'qc-mut')}>{m ? fmtPct(m.maxDD) : '—'}</td>
      <td className={retClass} title={title}>{m ? fmtPct(m.ret) : '—'}</td>
      <td className={m ? cls(m.cumulative) : 'qc-mut'}>{m ? fmtPct(m.cumulative) : '—'}</td>
    </>
  );
}

// Тройка ячеек строки статистики (просадка / доходность / накопит).
function StatTriple({ dd, ret, cum }: { dd?: ReactNode; ret?: ReactNode; cum?: ReactNode }) {
  return (
    <>
      <td className="grp">{dd ?? <span className="qc-mut">—</span>}</td>
      <td>{ret ?? <span className="qc-mut">—</span>}</td>
      <td>{cum ?? <span className="qc-mut">—</span>}</td>
    </>
  );
}

export default function PortfolioMatrix({ data }: { data: PortfolioResponse }) {
  const { years, algos, benchmark } = data;
  const failing = algos.filter(a => a.error);

  if (!algos.length) {
    return <div className="qc-panel"><div className="qc-state">В анализе нет стратегий — добавьте стратегию или включите архив.</div></div>;
  }
  if (!years.length) {
    return (
      <div className="qc-panel">
        <div className="qc-state">
          Нет годовых данных по бектестам.{failing.length ? '' : ' Проверьте, что у проектов есть завершённые бектесты.'}
        </div>
        {failing.length > 0 && (
          <div className="qc-err" style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            {failing.map(a => <div key={a.id}>{a.name}: {a.error}</div>)}
          </div>
        )}
      </div>
    );
  }

  const benchYears = benchmark?.years;
  const stats = algos.map(a => aggStats(a.years, years, benchYears));
  const bStats = benchmark ? aggStats(benchmark.years, years) : null;

  const bestWorst = (st: Stats) => (
    st.best == null ? null : <><span className="qc-pos">{fmtPct(st.best)}</span> <span className="qc-mut">/</span> <span className="qc-neg">{fmtPct(st.worst)}</span></>
  );
  const winCell = (st: Stats) => (
    st.compared ? <span className={st.beat! * 2 >= st.compared ? 'qc-pos' : 'qc-mut'}>{st.beat}<span className="qc-mut">/{st.compared}</span></span> : null
  );

  return (
    <>
      <div className="qc-tblwrap">
        <table className="qc-matrix">
          <thead>
            <tr className="groups">
              <th className="yr" rowSpan={2}>Год</th>
              {algos.map(a => (
                <th key={a.id} className="grp" colSpan={3} title={a.error || a.description || `project #${a.projectId}`}>
                  {a.name}{a.error ? ' ⚠' : ''}
                </th>
              ))}
              {benchmark && <th className="grp bench" colSpan={3}>{benchmark.name}</th>}
            </tr>
            <tr>
              {algos.map(a => (
                <Fragment key={a.id}>
                  <th className="grp">Просадка</th>
                  <th>Доходн.</th>
                  <th>Накопит.</th>
                </Fragment>
              ))}
              {benchmark && (
                <>
                  <th className="grp">Просадка</th>
                  <th>Доходн.</th>
                  <th>Накопит.</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {years.map(y => (
              <tr key={y}>
                <td className="yr">{y}</td>
                {algos.map(a => <TripleCells key={a.id} m={a.years[y]} bench={benchYears?.[y]} />)}
                {benchmark && <TripleCells m={benchmark.years[y]} />}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="stat first">
              <td className="yr">Ср. / год</td>
              {stats.map((st, i) => (
                <StatTriple key={algos[i].id}
                  dd={<span className={cls(st.avgDD)}>{fmtPct(st.avgDD)}</span>}
                  ret={<span className={cls(st.avgRet)}>{fmtPct(st.avgRet)}</span>} />
              ))}
              {bStats && <StatTriple dd={<span className={cls(bStats.avgDD)}>{fmtPct(bStats.avgDD)}</span>} ret={<span className={cls(bStats.avgRet)}>{fmtPct(bStats.avgRet)}</span>} />}
            </tr>
            <tr className="stat">
              <td className="yr" title="Среднегодовой геометрический рост (CAGR)">CAGR</td>
              {algos.map((a, i) => (
                <StatTriple key={a.id} ret={<span className={cls(cagr(a.totalReturn, stats[i].n))}>{fmtPct(cagr(a.totalReturn, stats[i].n))}</span>} />
              ))}
              {bStats && benchmark && <StatTriple ret={<span className={cls(cagr(benchmark.totalReturn, bStats.n))}>{fmtPct(cagr(benchmark.totalReturn, bStats.n))}</span>} />}
            </tr>
            <tr className="stat">
              <td className="yr">σ (разброс)</td>
              {stats.map((st, i) => (
                <StatTriple key={algos[i].id}
                  dd={<span className="qc-mut">±{fmtPctU(st.stdDD)}</span>}
                  ret={<span className="qc-mut">±{fmtPctU(st.stdRet)}</span>} />
              ))}
              {bStats && <StatTriple dd={<span className="qc-mut">±{fmtPctU(bStats.stdDD)}</span>} ret={<span className="qc-mut">±{fmtPctU(bStats.stdRet)}</span>} />}
            </tr>
            <tr className="stat">
              <td className="yr">Лучший / худший</td>
              {stats.map((st, i) => <StatTriple key={algos[i].id} ret={bestWorst(st)} />)}
              {bStats && <StatTriple ret={bestWorst(bStats)} />}
            </tr>
            {benchmark && (
              <tr className="stat">
                <td className="yr">Лет лучше БМ</td>
                {stats.map((st, i) => <StatTriple key={algos[i].id} ret={winCell(st)} />)}
                <StatTriple />
              </tr>
            )}
            <tr className="stat total">
              <td className="yr">Итог</td>
              {algos.map(a => <StatTriple key={a.id} cum={<span className={cls(a.totalReturn)}>{fmtPct(a.totalReturn)}</span>} />)}
              {benchmark && <StatTriple cum={<span className={cls(benchmark.totalReturn)}>{fmtPct(benchmark.totalReturn)}</span>} />}
            </tr>
          </tfoot>
        </table>
      </div>

      {failing.length > 0 && (
        <div className="qc-err" style={{ fontSize: 12, marginTop: 10 }}>
          {failing.map(a => <div key={a.id}>⚠ {a.name}: {a.error}</div>)}
        </div>
      )}
    </>
  );
}
