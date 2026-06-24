'use client';

import { useState } from 'react';
import Agenda from './_components/Agenda';
import ForecastMatrix from './_components/ForecastMatrix';
import ResultsAnalysis from './_components/ResultsAnalysis';
import SkillTable from './_components/SkillTable';
import WhitelistVsUniverse from './_components/WhitelistVsUniverse';
import AiSummary from './_components/AiSummary';
import type { SelectionRule } from './metrics';
import { COUNTRIES, type SignalTier } from './mock';

type Granularity = 'year' | 'quarter';
type RuleKind = 'tier' | 'topK';

export default function ForecastsPage() {
  const [gran, setGran] = useState<Granularity>('year');
  const [ruleKind, setRuleKind] = useState<RuleKind>('tier');
  const [minTier, setMinTier] = useState<SignalTier>(1); // держим ≥ OW
  const [k, setK] = useState(4);

  const rule: SelectionRule = ruleKind === 'tier' ? { kind: 'tier', min: minTier } : { kind: 'topK', k };

  return (
    <main>
      <div className="qc-top">
        <div className="qc-title">Прогнозы ИБ vs реальная доходность</div>
        <div className="qc-sub">Сигнал прогноза (с источником) против факта по странам. Оценка сигнала и решение — вайт-лист или держать всю вселенную.</div>
      </div>

      <div className="fc-proto">
        <span className="tag">прототип v2</span>
        <span>Прогнозы — <b>разнородные сигналы с источниками</b> (OW/UW, число, текст), есть пропуски. Все данные пока <b>синтетические</b>; реальные подтянем веб-поиском (Sonar) после твоего «ок».</span>
      </div>

      <nav className="fc-toc">
        <a href="#agenda"><span className="n">1</span>Повестка</a>
        <a href="#returns"><span className="n">2</span>Сигнал vs факт</a>
        <a href="#assess"><span className="n">3</span>Анализ результата</a>
        <a href="#whitelist"><span className="n">4</span>Вайт-лист</a>
        <a href="#ai"><span className="n">5</span>AI-резюме</a>
      </nav>

      {/* 1 */}
      <section id="agenda" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">1</span><span className="fc-sec-t">Повестка</span></div>
        <Agenda />
      </section>

      {/* 2 */}
      <section id="returns" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">2</span><span className="fc-sec-t">Сигнал прогноза vs факт</span></div>
        <div className="fc-sec-d">
          Чип — консенсус-сигнал (<b className="fc-leg t1">OW</b> бычий, <b className="fc-leg t0">EW</b> нейтр., <b className="fc-leg tm1">UW</b> медв.; <b>⚡</b> — банки расходятся). Клик по чипу → цитаты и источники.
          Факт залит <b className="qc-pos">зелёным</b>/<b className="qc-neg">красным</b> = совпал/против сигнала; <b>н.д.</b> / <b>— нет</b> — пропуски.
        </div>
        <div className="qc-controls-bar">
          <div className="fc-ctrl-grp">
            <span className="lbl">Гранулярность</span>
            <div className="qc-seg">
              <button className={gran === 'year' ? 'on' : ''} onClick={() => setGran('year')}>Год</button>
              <button className={gran === 'quarter' ? 'on' : ''} onClick={() => setGran('quarter')}>Кварталы</button>
            </div>
          </div>
          <span className="qc-spacer" />
          <span className="fc-ai-note">
            {gran === 'year' ? 'Сигнал — годовой консенсус; факт — за год.' : 'Раскадровка: факт по кварталам (компаундируется в год), сигнал — в шапке года.'}
          </span>
        </div>
        <ForecastMatrix granularity={gran} />
      </section>

      {/* 3 */}
      <section id="assess" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">3</span><span className="fc-sec-t">Оценка: сигнал → результат</span></div>
        <div className="fc-sec-d">Насколько сигнал прогноза предсказывает факт. Первичные метрики — ранговые (устойчивы к формату и пропускам).</div>
        <ResultsAnalysis />
        <div className="qc-panel-h" style={{ marginTop: 18 }}>3.5 · Навык по странам</div>
        <SkillTable />
      </section>

      {/* 4 */}
      <section id="whitelist" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">4</span><span className="fc-sec-t">Вайт-лист vs вся вселенная</span></div>
        <div className="fc-sec-d">Стоит ли отбирать страны по сигналу — или держать всё равновесно.</div>
        <div className="qc-controls-bar">
          <div className="fc-ctrl-grp">
            <span className="lbl">Правило отбора</span>
            <div className="qc-seg">
              <button className={ruleKind === 'tier' ? 'on' : ''} onClick={() => setRuleKind('tier')}>По сигналу</button>
              <button className={ruleKind === 'topK' ? 'on' : ''} onClick={() => setRuleKind('topK')}>Топ-K</button>
            </div>
          </div>
          {ruleKind === 'tier' ? (
            <div className="fc-ctrl-grp">
              <span className="lbl">Держать ≥</span>
              <div className="qc-seg">
                <button className={minTier === 2 ? 'on' : ''} onClick={() => setMinTier(2)}>Strong OW</button>
                <button className={minTier === 1 ? 'on' : ''} onClick={() => setMinTier(1)}>OW</button>
                <button className={minTier === 0 ? 'on' : ''} onClick={() => setMinTier(0)}>EW</button>
              </div>
            </div>
          ) : (
            <div className="fc-ctrl-grp">
              <span className="lbl">K</span>
              <input className="qc-input fc-num" type="number" min={1} max={COUNTRIES.length} value={k}
                onChange={(e) => setK(Math.max(1, Math.min(COUNTRIES.length, Number(e.target.value) || 1)))} />
              <span className="qc-mut">из {COUNTRIES.length} стран/год</span>
            </div>
          )}
        </div>
        <WhitelistVsUniverse rule={rule} />
      </section>

      {/* 5 */}
      <section id="ai" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">5</span><span className="fc-sec-t">AI-резюме</span></div>
        <div className="fc-sec-d">Текстовый вывод после математической оценки.</div>
        <AiSummary rule={rule} />
      </section>
    </main>
  );
}
