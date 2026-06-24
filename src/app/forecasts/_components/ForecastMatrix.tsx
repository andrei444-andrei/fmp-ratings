'use client';

import { Fragment, useState } from 'react';
import { YEARS, consensusOf, quarterize, cumulativePath, TIER, FORMAT_RU, type Cell, type Country, type CountrySeries } from '../mock';
import { mean } from '../metrics';
import { pct, signClass } from '../fmt';
import SignalChip, { tierClass } from './SignalChip';

type Granularity = 'year' | 'quarter';
type Sel = { cell: Cell; country: Country } | null;
const Q = [1, 2, 3, 4];

function universeReal(data: CountrySeries[], year: number): number | null {
  const vals = data.map((s) => s.cells.find((c) => c.year === year)?.real).filter((x): x is number => x != null);
  return vals.length ? mean(vals) : null;
}

export default function ForecastMatrix({ granularity, data }: { granularity: Granularity; data: CountrySeries[] }) {
  const [sel, setSel] = useState<Sel>(null);
  const open = (cell: Cell, country: Country) => setSel((p) => (p?.cell === cell ? null : { cell, country }));

  return (
    <>
      <div className="qc-tblwrap">
        <table className="qc-matrix fc-matrix">
          <thead>
            <tr className="groups">
              <th className="yr" rowSpan={2}>{granularity === 'year' ? 'Год' : 'Период'}</th>
              {data.map((s) => (
                <th key={s.country.code} className="grp" colSpan={granularity === 'year' ? 2 : 1} title={s.country.name + ' · ' + s.country.bench}>
                  {s.country.flag} {s.country.code}
                </th>
              ))}
              <th className="grp uni" colSpan={granularity === 'year' ? 2 : 1}>Вселенная EW</th>
            </tr>
            <tr>
              {data.map((s) =>
                granularity === 'year'
                  ? <Fragment key={s.country.code}><th className="grp">Сигнал</th><th>Факт</th></Fragment>
                  : <th key={s.country.code} className="grp">Факт</th>,
              )}
              {granularity === 'year' ? <><th className="grp">—</th><th>Факт</th></> : <th className="grp">Факт</th>}
            </tr>
          </thead>
          {granularity === 'year'
            ? <AnnualBody data={data} sel={sel} open={open} />
            : <QuarterBody data={data} sel={sel} open={open} />}
        </table>
      </div>
      {sel && <SourcesPanel sel={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function FactCell({ real, sig, grp }: { real: number | null; sig: number | null; grp?: boolean }) {
  if (real == null) return <td className={(grp ? 'grp ' : '') + 'fc-r fc-na'} title="Нет фактических данных">н.д.</td>;
  const hit = sig != null && sig !== 0 ? Math.sign(sig) === Math.sign(real) : null;
  const cls = hit === true ? 'fc-hit' : hit === false ? 'fc-miss' : signClass(real);
  return (
    <td className={(grp ? 'grp ' : '') + 'fc-r ' + cls}
      title={sig != null ? `факт ${pct(real)} · ${hit === true ? 'совпал с сигналом' : hit === false ? 'против сигнала' : 'сигнал нейтрален'}` : `факт ${pct(real)}`}>
      {pct(real)}
    </td>
  );
}

function AnnualBody({ data, sel, open }: { data: CountrySeries[]; sel: Sel; open: (c: Cell, co: Country) => void }) {
  return (
    <tbody>
      {YEARS.map((year) => (
        <tr key={year}>
          <td className="yr">{year}</td>
          {data.map((s) => {
            const cell = s.cells.find((c) => c.year === year)!;
            return (
              <Fragment key={s.country.code}>
                <td className="grp fc-sig"><SignalChip cell={cell} active={sel?.cell === cell} onOpen={() => open(cell, s.country)} /></td>
                <FactCell real={cell.real} sig={consensusOf(cell).signal} />
              </Fragment>
            );
          })}
          <td className="grp uni fc-sig"><span className="qc-mut" style={{ fontSize: 11 }}>—</span></td>
          <FactCell real={universeReal(data, year)} sig={null} />
        </tr>
      ))}
    </tbody>
  );
}

function QuarterBody({ data, sel, open }: { data: CountrySeries[]; sel: Sel; open: (c: Cell, co: Country) => void }) {
  return (
    <tbody>
      {YEARS.map((year) => {
        const perCountryQ = data.map((s) => {
          const cell = s.cells.find((c) => c.year === year)!;
          return { code: s.country.code, q: cell.real != null ? quarterize(s.country.code, year, cell.real) : null };
        });
        const uniQ = Q.map((_, qi) => {
          const vals = perCountryQ.map((p) => p.q?.[qi]).filter((x): x is number => x != null);
          return vals.length ? mean(vals) : null;
        });
        const uniCum = cumulativePath(uniQ.map((x) => x ?? 0));
        return (
          <Fragment key={year}>
            <tr className="yhead">
              <td className="yr">{year}</td>
              {data.map((s) => {
                const cell = s.cells.find((c) => c.year === year)!;
                return <td key={s.country.code} className="grp fc-sig"><SignalChip cell={cell} active={sel?.cell === cell} onOpen={() => open(cell, s.country)} /></td>;
              })}
              <td className="grp uni qlabel">год</td>
            </tr>
            {Q.map((q, qi) => (
              <tr key={q}>
                <td className="yr qlbl">Q{q}</td>
                {perCountryQ.map((p) => (
                  <td key={p.code} className={'grp fc-r ' + (p.q ? signClass(p.q[qi]) : 'fc-na')}>{p.q ? pct(p.q[qi]) : 'н.д.'}</td>
                ))}
                <td className={'grp uni fc-r ' + (uniQ[qi] != null ? signClass(uniQ[qi]) : 'fc-na')} title={`YTD: ${pct(uniCum[qi])}`}>
                  {uniQ[qi] != null ? pct(uniQ[qi]) : 'н.д.'}
                </td>
              </tr>
            ))}
            <tr>
              <td className="yr qlbl" style={{ fontWeight: 700 }}>Год</td>
              {perCountryQ.map((p) => {
                const yr = data.find((s) => s.country.code === p.code)!.cells.find((c) => c.year === year)!.real;
                return <td key={p.code} className={'grp fc-r ' + (yr != null ? signClass(yr) : 'fc-na')} style={{ fontWeight: 700 }}>{yr != null ? pct(yr) : 'н.д.'}</td>;
              })}
              <td className={'grp uni fc-r ' + (universeReal(data, year) != null ? signClass(universeReal(data, year)) : 'fc-na')} style={{ fontWeight: 700 }}>{pct(universeReal(data, year))}</td>
            </tr>
          </Fragment>
        );
      })}
    </tbody>
  );
}

function SourcesPanel({ sel, onClose }: { sel: NonNullable<Sel>; onClose: () => void }) {
  const { cell, country } = sel;
  const con = consensusOf(cell);
  return (
    <div className="fc-src">
      <div className="fc-src-h">
        <span>{country.flag} {country.name} · {cell.year}</span>
        {con.tier != null && <span className={'fc-chip ' + tierClass(con.tier)}>{TIER[con.tier].long}</span>}
        {con.spread > 0 && <span className="fc-src-sp">разброс мнений: {con.spread}</span>}
        <span className="qc-spacer" />
        <button className="qc-icon" onClick={onClose} title="Закрыть">✕</button>
      </div>
      {cell.forecasts.length ? (
        <ul className="fc-src-list">
          {cell.forecasts.map((f, i) => (
            <li key={i}>
              <div className="fc-src-row">
                <span className={'fc-chip sm ' + tierClass(f.signal)}>{TIER[f.signal].short}</span>
                <b>{f.bank}</b>
                <span className="fc-src-fmt">{FORMAT_RU[f.format]}</span>
                {f.extractedBy && <span className={'fc-src-by ' + f.extractedBy}>{f.verified ? 'проверено' : f.extractedBy === 'sonar' ? 'AI' : f.extractedBy === 'synthetic' ? 'синтетика' : 'вручную'}{f.confidence != null && !f.verified ? ` ${Math.round(f.confidence * 100)}%` : ''}</span>}
                <span className="qc-spacer" />
                {(f.publishedAt || f.asOf) && (
                  <span className={'fc-src-pub' + (f.sourceVerified ? ' ok' : f.dateOk === false ? ' warn' : '')}
                    title={f.sourceVerified ? 'дата подтверждена по странице источника' : f.dateOk === false ? 'дата публикации не подтверждена — на ручную проверку' : 'дата по заявлению источника'}>
                    {f.sourceVerified ? '✓ ' : f.dateOk === false ? '⚠ ' : '📅 '}{(f.publishedAt && f.publishedAt.replace(/-00$/, '')) || f.asOf}
                  </span>
                )}
              </div>
              <div className="fc-src-quote">«{f.quote}»</div>
              {f.reasoning && <div className="fc-src-reason">{f.reasoning}</div>}
              {f.sourceUrl
                ? <a className="fc-src-link" href={f.sourceUrl} target="_blank" rel="noreferrer">{f.sourceName || 'источник'} ↗</a>
                : <span className="fc-src-link" style={{ opacity: .6 }}>{f.sourceName || 'без ссылки'}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="qc-state">Нет прогноза на эту ячейку.{' '}<span className="qc-mut">Нажмите «Добрать прогнозы (AI)», чтобы найти.</span></div>
      )}
    </div>
  );
}
