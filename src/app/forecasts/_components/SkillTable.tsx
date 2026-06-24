'use client';

import { allSkills, VERDICT_RU, type Verdict } from '../metrics';
import { pct, pctU, coef, signClass } from '../fmt';

// Секция 3a — таблица предсказательной силы прогноза по странам.
// Где прогноз ИБ реально несёт сигнал, а где это шум / систематический оптимизм.

const VERDICT_CLASS: Record<Verdict, string> = {
  trade: 'active',     // зелёный бейдж
  hold: 'research',    // жёлтый
  noise: 'archive',    // серый
};

export default function SkillTable() {
  const skills = allSkills();
  return (
    <div className="qc-tblwrap">
      <table className="qc-matrix">
        <thead>
          <tr>
            <th className="yr" style={{ textAlign: 'left' }}>Страна</th>
            <th title="Число лет в выборке">N</th>
            <th title="Доля лет с верным направлением (знак прогноза = знак факта)">Попадание</th>
            <th title="Информационный коэффициент: corr(прогноз, факт), Пирсон">IC</th>
            <th title="Ранговая корреляция (Спирмен) — устойчивость порядка">ранг-IC</th>
            <th title="Ср.(прогноз − факт): &gt;0 — ИБ систематически оптимистичен">Смещение</th>
            <th title="Ср. модуль ошибки прогноза">MAE</th>
            <th>Вердикт</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.code}>
              <td className="yr" style={{ textAlign: 'left' }}>{s.flag} {s.name}</td>
              <td>{s.n}</td>
              <td className={s.hitRate >= 0.66 ? 'qc-pos' : s.hitRate < 0.5 ? 'qc-neg' : ''}>{(s.hitRate * 100).toFixed(0)}%</td>
              <td className={signClass(s.ic)}>{coef(s.ic)}</td>
              <td className={signClass(s.rankIc)}>{coef(s.rankIc)}</td>
              <td className="qc-mut" title="Смещение = ср.(прогноз − факт). >0 — оптимизм (над фактом); <0 — консерватизм (под фактом)">{pct(s.bias)}</td>
              <td className="qc-mut">{pctU(s.mae)}</td>
              <td>
                <span className={'qc-badge ' + VERDICT_CLASS[s.verdict]}>{VERDICT_RU[s.verdict]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
