'use client';

import { rankIC, owUwSpread, tierMatrix, numericMetrics, coverage } from '../metrics';
import { pct, pctU, coef, signClass } from '../fmt';

// Секция 3 — анализ РЕЗУЛЬТАТА: насколько сигнал прогноза предсказывает факт.
// Первичные метрики ранговые/категориальные (устойчивы к формату и пропускам),
// числовые — отдельно, только где банк дал число.
export default function ResultsAnalysis() {
  const cov = coverage();
  const ic = rankIC();
  const sp = owUwSpread();
  const tm = tierMatrix();
  const num = numericMetrics();
  const lift = tm.directionalTotal ? tm.directionalCorrect / tm.directionalTotal - tm.baseRateUp : null;

  return (
    <>
      {/* покрытие */}
      <div className="qc-cards">
        <Card k="Покрытие прогнозом" v={`${cov.withForecast}/${cov.cells}`} sub={`${Math.round((cov.withForecast / cov.cells) * 100)}% ячеек`} />
        <Card k="Покрытие фактом" v={`${cov.withReal}/${cov.cells}`} sub={`${Math.round((cov.withReal / cov.cells) * 100)}% ячеек`} />
        <Card k="Пар (прогноз+факт)" v={`${cov.withBoth}`} sub="идут в метрики" />
        <Card k="Пропуски" v={`${cov.cells - cov.withBoth}`} sub="не импутируем" cls="qc-mut" />
      </div>

      {/* 3.1 Rank IC */}
      <div className="qc-panel-h" style={{ marginTop: 6 }}>3.1 · Rank IC по годам <span className="c">кросс-секционно: ранг сигнала vs ранг факта (Спирмен)</span></div>
      <div className="qc-tblwrap">
        <table className="qc-matrix">
          <thead><tr><th className="yr" style={{ textAlign: 'left' }}>Год</th>{ic.byYear.map((y) => <th key={y.year}>{y.year}</th>)}<th className="grp">среднее</th></tr></thead>
          <tbody>
            <tr>
              <td className="yr" style={{ textAlign: 'left' }}>Rank IC</td>
              {ic.byYear.map((y) => <td key={y.year} className={signClass(y.ic)} title={`стран: ${y.n}`}>{coef(y.ic)}</td>)}
              <td className={'grp ' + signClass(ic.meanIC)} style={{ fontWeight: 700 }}>{coef(ic.meanIC)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="fc-sec-d" style={{ marginTop: 8 }}>
        Среднее IC <b className={signClass(ic.meanIC)}>{coef(ic.meanIC)}</b>, σ {coef(ic.stdIC)}, t-стат <b>{ic.tStat?.toFixed(2) ?? '—'}</b> по {ic.kYears} годам.
        {ic.tStat != null && Math.abs(ic.tStat) < 2 && <> Это <b>статистически незначимо</b> (|t|&lt;2) — слабый положительный сигнал, неотличимый от удачи на коротком окне.</>}
      </div>

      {/* 3.2 OW−UW спред */}
      <div className="qc-panel-h" style={{ marginTop: 18 }}>3.2 · Спред OW − UW <span className="c">доходность корзины overweight минус underweight</span></div>
      <div className="qc-tblwrap">
        <table className="qc-matrix">
          <thead><tr><th className="yr" style={{ textAlign: 'left' }}>Год</th><th>OW (факт)</th><th>UW (факт)</th><th className="grp">Спред</th><th style={{ textAlign: 'left' }}>корзины</th></tr></thead>
          <tbody>
            {sp.rows.map((r) => (
              <tr key={r.year}>
                <td className="yr">{r.year}</td>
                <td className={signClass(r.owReal)}>{pct(r.owReal)}</td>
                <td className={signClass(r.uwReal)}>{pct(r.uwReal)}</td>
                <td className={'grp ' + signClass(r.spread)} style={{ fontWeight: 600 }}>{pct(r.spread)}</td>
                <td style={{ textAlign: 'left' }} className="qc-mut">OW×{r.owN} / UW×{r.uwN}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="stat total">
              <td className="yr">Среднее</td><td /><td />
              <td className={'grp ' + signClass(sp.avgSpread)}>{pct(sp.avgSpread)}</td>
              <td style={{ textAlign: 'left' }} className="qc-mut">лет в плюс: {sp.hitYears}/{sp.validYears}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="fc-sec-d" style={{ marginTop: 8 }}>
        Средний спред <b className={signClass(sp.avgSpread)}>{pct(sp.avgSpread)}</b> ({sp.hitYears}/{sp.validYears} лет положительный) — это и есть «навык» относительных рейтингов: насколько то, что банки любят (OW), обгоняет то, что не любят (UW).
      </div>

      {/* 3.3 Матрица тиров */}
      <div className="qc-panel-h" style={{ marginTop: 18 }}>3.3 · Сигнал → результат (матрица тиров)</div>
      <div className="fc-confwrap">
        <table className="qc-matrix" style={{ minWidth: 0 }}>
          <thead><tr><th className="yr" style={{ textAlign: 'left' }}>Сигнал</th><th>Факт рост</th><th>Факт падение</th><th className="grp">всего</th></tr></thead>
          <tbody>
            {tm.rows.map((r) => {
              const correct = r.tier === 'OW' ? 'up' : r.tier === 'UW' ? 'down' : null;
              return (
                <tr key={r.tier}>
                  <td className="yr" style={{ textAlign: 'left' }}>{r.tier === 'OW' ? 'OW (бычий)' : r.tier === 'UW' ? 'UW (медвежий)' : 'EW (нейтр.)'}</td>
                  <td className={correct === 'up' ? 'qc-pos' : correct === 'down' ? 'qc-neg' : ''} style={{ fontWeight: correct === 'up' ? 700 : 400 }}>{r.up}</td>
                  <td className={correct === 'down' ? 'qc-pos' : correct === 'up' ? 'qc-neg' : ''} style={{ fontWeight: correct === 'down' ? 700 : 400 }}>{r.down}</td>
                  <td className="grp qc-mut">{r.up + r.down}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="fc-conf-side">
          <div className="qc-cards" style={{ marginBottom: 0 }}>
            <Card k="Точность направления" v={tm.directionalTotal ? `${Math.round((tm.directionalCorrect / tm.directionalTotal) * 100)}%` : '—'} sub={`OW→рост, UW→падение (${tm.directionalCorrect}/${tm.directionalTotal})`} />
            <Card k="База (рынок рос)" v={`${Math.round(tm.baseRateUp * 100)}%`} sub="лет вообще" />
            <Card k="Прирост над базой" v={lift != null ? `${lift > 0 ? '+' : lift < 0 ? '−' : ''}${Math.abs(lift * 100).toFixed(0)} пп` : '—'} sub="чистая польза сигнала" cls={lift != null ? (lift > 0.02 ? 'qc-pos' : lift < -0.02 ? 'qc-neg' : 'qc-mut') : 'qc-mut'} />
          </div>
          <p style={{ marginTop: 12 }}>
            EW-строка — «нет направленного кола» (в точность не входит). Малый прирост над базой ⇒ направленная часть прогноза почти не добавляет к «всегда в лонге»; вся ценность — в относительном ранжировании (спред OW−UW) и в избегании UW.
          </p>
        </div>
      </div>

      {/* 3.4 числовые метрики */}
      <div className="qc-panel-h" style={{ marginTop: 18 }}>3.4 · Числовые метрики <span className="c">только по {num.n} прогнозам, где банк дал число</span></div>
      <div className="qc-cards" style={{ marginBottom: 0 }}>
        <Card k="Pearson IC" v={coef(num.ic)} sub="число прогноза vs факт" cls={signClass(num.ic)} />
        <Card k="MAE" v={pctU(num.mae)} sub="ср. модуль ошибки" cls="qc-mut" />
        <Card k="Смещение" v={pct(num.bias)} sub={num.bias > 0 ? 'оптимизм (над фактом)' : 'консерватизм (под фактом)'} cls="qc-mut" />
        <Card k="Где есть число" v={`${num.n}`} sub="из 45 прогнозов" cls="qc-mut" />
      </div>
    </>
  );
}

function Card({ k, v, sub, cls }: { k: string; v: string; sub: string; cls?: string }) {
  return (
    <div className="qc-card">
      <div className="qc-card-k">{k}</div>
      <div className={'qc-card-v ' + (cls ?? '')}>{v}</div>
      <div className="qc-card-sub">{sub}</div>
    </div>
  );
}
