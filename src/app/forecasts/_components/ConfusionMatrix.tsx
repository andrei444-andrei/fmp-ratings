'use client';

import { confusion } from '../metrics';

// Секция 3b — сигнал → результат как матрица ошибок 2×2.
// Сигнал = знак прогноза (рост/падение), результат = знак факта.
// Прямо отвечает на «сделать оценку сигнал результат» из ТЗ.
export default function ConfusionMatrix() {
  const c = confusion();
  const lift = c.precisionUp != null ? c.precisionUp - c.baseRateUp : null;
  return (
    <div className="fc-confwrap">
      <table className="fc-conf">
        <tbody>
          <tr>
            <td />
            <td />
            <td className="axis" colSpan={2}>Факт</td>
          </tr>
          <tr>
            <td />
            <td />
            <td className="hd">рост</td>
            <td className="hd">падение</td>
          </tr>
          <tr>
            <td className="axis v" rowSpan={2}>Прогноз</td>
            <td className="hd">рост</td>
            <td className="cell good"><div className="v">{c.bullUp}</div><div className="k">верный позитив</div></td>
            <td className="cell bad"><div className="v">{c.bullDown}</div><div className="k">ложная тревога</div></td>
          </tr>
          <tr>
            <td className="hd">падение</td>
            <td className="cell bad"><div className="v">{c.bearUp}</div><div className="k">упущенный рост</div></td>
            <td className="cell good"><div className="v">{c.bearDown}</div><div className="k">верный негатив</div></td>
          </tr>
        </tbody>
      </table>

      <div className="fc-conf-side">
        <div className="qc-cards" style={{ marginBottom: 0 }}>
          <div className="qc-card">
            <div className="qc-card-k">Точность</div>
            <div className="qc-card-v">{(c.accuracy * 100).toFixed(0)}%</div>
            <div className="qc-card-sub">верных из {c.total}</div>
          </div>
          <div className="qc-card">
            <div className="qc-card-k">Когда прогноз «рост»</div>
            <div className="qc-card-v">{c.precisionUp != null ? (c.precisionUp * 100).toFixed(0) + '%' : '—'}</div>
            <div className="qc-card-sub">фактически рос</div>
          </div>
          <div className="qc-card">
            <div className="qc-card-k">База (рынок рос)</div>
            <div className="qc-card-v">{(c.baseRateUp * 100).toFixed(0)}%</div>
            <div className="qc-card-sub">лет вообще</div>
          </div>
        </div>
        <p style={{ marginTop: 12 }}>
          Ключевой тест: даёт ли прогноз <b>прирост над базой</b>. Точность «рост→рост»{' '}
          {lift != null && (
            <b className={lift > 0.02 ? 'qc-pos' : lift < -0.02 ? 'qc-neg' : 'qc-mut'}>
              {lift > 0 ? '+' : lift < 0 ? '−' : ''}{Math.abs(lift * 100).toFixed(0)} пп
            </b>
          )}{' '}
          к тому, как часто рынок рос сам по себе. Малый прирост ⇒ прогноз почти не
          добавляет к «всегда быть в лонге».
        </p>
        <p className="qc-mut" style={{ fontSize: 11.5 }}>
          ИБ почти всегда дают позитивный прогноз, поэтому строки «прогноз падение»
          разрежены — для них вывод особенно шаткий на коротком окне.
        </p>
      </div>
    </div>
  );
}
