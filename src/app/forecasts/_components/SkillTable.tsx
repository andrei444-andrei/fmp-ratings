'use client';

import { allSkills, VERDICT_RU, type Verdict } from '../metrics';
import type { CountrySeries } from '../mock';
import { coef, signClass } from '../fmt';

// 3.5 — навык по активу (drilldown): где консенсус-сигнал предсказывает факт.
const VERDICT_CLASS: Record<Verdict, string> = { trade: 'active', hold: 'research', noise: 'archive' };

export default function SkillTable({ data }: { data: CountrySeries[] }) {
  const skills = allSkills(data);
  return (
    <div className="qc-tblwrap">
      <table className="qc-matrix">
        <thead>
          <tr>
            <th className="yr" style={{ textAlign: 'left' }}>Страна</th>
            <th title="Доля лет, на которые есть прогноз">Покрытие</th>
            <th title="Лет с прогнозом И фактом">N пар</th>
            <th title="Доля лет с верным направлением (исключая нейтральные EW)">Попадание</th>
            <th title="Спирмен(сигнал, факт) по годам — устойчив к формату">rank-IC</th>
            <th title="Pearson IC по годам, где банк давал число">числ.IC</th>
            <th>Вердикт</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.code}>
              <td className="yr" style={{ textAlign: 'left' }}>{s.flag} {s.name}</td>
              <td className={s.coverage < 1 ? 'qc-mut' : ''}>{Math.round(s.coverage * 100)}%</td>
              <td>{s.pairs}</td>
              <td className={s.hitRate == null ? 'qc-mut' : s.hitRate >= 0.66 ? 'qc-pos' : s.hitRate < 0.5 ? 'qc-neg' : ''}>
                {s.hitRate == null ? '—' : Math.round(s.hitRate * 100) + '%'}
              </td>
              <td className={signClass(s.rankIc)}>{coef(s.rankIc)}</td>
              <td className={signClass(s.numericIc)}>{coef(s.numericIc)}</td>
              <td><span className={'qc-badge ' + VERDICT_CLASS[s.verdict]}>{VERDICT_RU[s.verdict]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
