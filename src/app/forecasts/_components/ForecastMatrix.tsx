'use client';

import { Fragment } from 'react';
import { DATA, YEARS, quarterize, cumulativePath } from '../mock';
import { mean } from '../metrics';
import { pct, signClass } from '../fmt';

// Секция 2 — матрица «прогноз vs факт». Два режима:
//  • «Год»: строки — годы; на страну под-колонки [Прогноз | Факт]; факт залит
//    зелёным/красным, если знак совпал/не совпал с прогнозом. Справа колонка
//    «Вселенная (EW)» — равновзвешенный факт.
//  • «Кварталы»: раскадровка факта по кварталам (компаундируется в год); прогноз
//    ИБ годовой — показан в строке-заголовке года как ориентир.

type Granularity = 'year' | 'quarter';

const Q = [1, 2, 3, 4];

function universeRealByYear(year: number): number {
  const vals = DATA.map((s) => s.annual.find((a) => a.year === year)?.real).filter((x): x is number => x != null);
  return mean(vals);
}

export default function ForecastMatrix({ granularity }: { granularity: Granularity }) {
  return (
    <div className="qc-tblwrap">
      <table className="qc-matrix fc-matrix">
        <thead>
          <tr className="groups">
            <th className="yr" rowSpan={2}>{granularity === 'year' ? 'Год' : 'Период'}</th>
            {DATA.map((s) => (
              <th key={s.country.code} className="grp" colSpan={granularity === 'year' ? 2 : 1}
                title={s.country.name + ' · ' + s.country.bench}>
                {s.country.flag} {s.country.code}
              </th>
            ))}
            <th className="grp uni" colSpan={granularity === 'year' ? 2 : 1}>Вселенная EW</th>
          </tr>
          <tr>
            {DATA.map((s) =>
              granularity === 'year' ? (
                <Fragment key={s.country.code}>
                  <th className="grp">Прогноз</th>
                  <th>Факт</th>
                </Fragment>
              ) : (
                <th key={s.country.code} className="grp">Факт</th>
              ),
            )}
            {granularity === 'year' ? (
              <>
                <th className="grp">Прогноз</th>
                <th>Факт</th>
              </>
            ) : (
              <th className="grp">Факт</th>
            )}
          </tr>
        </thead>

        {granularity === 'year' ? <AnnualBody /> : <QuarterBody />}
      </table>
    </div>
  );
}

// ── Годовой режим ────────────────────────────────────────────────────────────
function AnnualBody() {
  return (
    <tbody>
      {YEARS.map((year) => {
        const uni = universeRealByYear(year);
        // средний прогноз вселенной — для колонки EW «прогноз»
        const uniF = mean(DATA.map((s) => s.annual.find((a) => a.year === year)?.forecast).filter((x): x is number => x != null));
        return (
          <tr key={year}>
            <td className="yr">{year}</td>
            {DATA.map((s) => {
              const c = s.annual.find((a) => a.year === year)!;
              const hit = Math.sign(c.forecast) === Math.sign(c.real);
              return (
                <Fragment key={s.country.code}>
                  <td className="grp fc-f" title="Прогноз ИБ на год">{pct(c.forecast)}</td>
                  <td className={'fc-r ' + (hit ? 'fc-hit' : 'fc-miss')}
                    title={`факт ${pct(c.real)} · ошибка ${pct(c.real - c.forecast)} · ${hit ? 'направление угадано' : 'направление не угадано'}`}>
                    {pct(c.real)}
                  </td>
                </Fragment>
              );
            })}
            <td className="grp uni fc-f">{pct(uniF)}</td>
            <td className={'fc-r ' + signClass(uni)}>{pct(uni)}</td>
          </tr>
        );
      })}
    </tbody>
  );
}

// ── Поквартальный режим (раскадровка) ────────────────────────────────────────
function QuarterBody() {
  return (
    <tbody>
      {YEARS.map((year) => {
        const uniYear = universeRealByYear(year);
        // квартальные доходности по странам
        const perCountryQ = DATA.map((s) => {
          const real = s.annual.find((a) => a.year === year)!.real;
          return { code: s.country.code, q: quarterize(s.country.code, year, real) };
        });
        // вселенная по кварталу — равновзвешенно
        const uniQ = Q.map((_, qi) => mean(perCountryQ.map((p) => p.q[qi])));
        const uniCum = cumulativePath(uniQ);

        return (
          <Fragment key={year}>
            <tr className="yhead">
              <td className="yr">{year}</td>
              {DATA.map((s) => {
                const f = s.annual.find((a) => a.year === year)!.forecast;
                return <td key={s.country.code} className="grp qlabel" title="Прогноз ИБ на год (ориентир)">пр. {pct(f, 0)}</td>;
              })}
              <td className="grp uni qlabel">год</td>
            </tr>
            {Q.map((q, qi) => (
              <tr key={q}>
                <td className="yr qlbl">Q{q}</td>
                {perCountryQ.map((p) => (
                  <td key={p.code} className={'grp fc-r ' + signClass(p.q[qi])}>{pct(p.q[qi])}</td>
                ))}
                <td className={'grp uni fc-r ' + signClass(uniQ[qi])} title={`YTD: ${pct(uniCum[qi])}`}>{pct(uniQ[qi])}</td>
              </tr>
            ))}
            <tr>
              <td className="yr qlbl" style={{ fontWeight: 700 }}>Год</td>
              {perCountryQ.map((p) => {
                const yr = DATA.find((s) => s.country.code === p.code)!.annual.find((a) => a.year === year)!.real;
                return <td key={p.code} className={'grp fc-r ' + signClass(yr)} style={{ fontWeight: 700 }}>{pct(yr)}</td>;
              })}
              <td className={'grp uni fc-r ' + signClass(uniYear)} style={{ fontWeight: 700 }}>{pct(uniYear)}</td>
            </tr>
          </Fragment>
        );
      })}
    </tbody>
  );
}
