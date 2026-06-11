'use client';

import { Fragment } from 'react';
import type { PortfolioResponse, YearMetric } from '@/lib/quantconnect/types';

// Доля (0.123) → «+12.3%». Просадка отрицательная.
function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100;
  const s = p > 0 ? '+' : p < 0 ? '−' : '';
  return s + Math.abs(p).toFixed(digits) + '%';
}
function cls(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return 'qc-mut';
  return v > 0 ? 'qc-pos' : 'qc-neg';
}

// Тройка ячеек одной группы за год: просадка, доходность, накопительная.
function TripleCells({ m }: { m: YearMetric | undefined }) {
  return (
    <>
      <td className={'grp ' + (m ? cls(m.maxDD) : 'qc-mut')}>{m ? fmtPct(m.maxDD) : '—'}</td>
      <td className={m ? cls(m.ret) : 'qc-mut'}>{m ? fmtPct(m.ret) : '—'}</td>
      <td className={m ? cls(m.cumulative) : 'qc-mut'}>{m ? fmtPct(m.cumulative) : '—'}</td>
    </>
  );
}

export default function PortfolioMatrix({ data }: { data: PortfolioResponse }) {
  const { years, algos, benchmark } = data;
  const failing = algos.filter(a => a.error);

  if (!algos.length) {
    return <div className="qc-panel"><div className="qc-state">Портфель пуст — добавьте алгоритм выше.</div></div>;
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

  return (
    <>
      <div className="qc-tblwrap">
        <table className="qc-matrix">
          <thead>
            <tr className="groups">
              <th className="yr" rowSpan={2}>Год</th>
              {algos.map(a => (
                <th key={a.id} className="grp" colSpan={3} title={a.error || `project #${a.projectId}`}>
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
                {algos.map(a => <TripleCells key={a.id} m={a.years[y]} />)}
                {benchmark && <TripleCells m={benchmark.years[y]} />}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="yr">Итог</td>
              {algos.map(a => (
                <td key={a.id} className={'grp ' + cls(a.totalReturn)} colSpan={3} style={{ textAlign: 'right' }}>
                  {fmtPct(a.totalReturn)}
                </td>
              ))}
              {benchmark && (
                <td className={'grp ' + cls(benchmark.totalReturn)} colSpan={3} style={{ textAlign: 'right' }}>
                  {fmtPct(benchmark.totalReturn)}
                </td>
              )}
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
