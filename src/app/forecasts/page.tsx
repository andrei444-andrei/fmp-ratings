'use client';

import { useState } from 'react';
import Agenda from './_components/Agenda';
import ForecastMatrix from './_components/ForecastMatrix';
import SkillTable from './_components/SkillTable';
import ConfusionMatrix from './_components/ConfusionMatrix';
import WhitelistVsUniverse from './_components/WhitelistVsUniverse';
import AiSummary from './_components/AiSummary';
import type { SelectionRule } from './metrics';
import { COUNTRIES } from './mock';

type Granularity = 'year' | 'quarter';
type RuleKind = 'topK' | 'threshold';

export default function ForecastsPage() {
  const [gran, setGran] = useState<Granularity>('year');
  const [ruleKind, setRuleKind] = useState<RuleKind>('topK');
  const [k, setK] = useState(4);
  const [minPct, setMinPct] = useState(6); // прогноз ≥ 6%

  const rule: SelectionRule =
    ruleKind === 'topK' ? { kind: 'topK', k } : { kind: 'threshold', min: minPct / 100 };

  return (
    <main>
      <div className="qc-top">
        <div className="qc-title">Прогнозы ИБ vs реальная доходность</div>
        <div className="qc-sub">Матрица «год × страна»: прогноз инвестбанка против факта. Оценка сигнала и решение — вайт-лист стран или держать всю вселенную.</div>
      </div>

      <div className="fc-proto">
        <span className="tag">прототип</span>
        <span>Все числа ниже — <b>синтетический мок</b> для подтверждения структуры. Реальные прогнозы ИБ и фактическую доходность подключим после вашего «ок».</span>
      </div>

      {/* in-page навигация */}
      <nav className="fc-toc">
        <a href="#agenda"><span className="n">1</span>Повестка</a>
        <a href="#returns"><span className="n">2</span>Реальная доходность</a>
        <a href="#assess"><span className="n">3</span>Сигнал → результат</a>
        <a href="#ai"><span className="n">4</span>AI-резюме</a>
      </nav>

      {/* 1 — Повестка */}
      <section id="agenda" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">1</span><span className="fc-sec-t">Повестка</span></div>
        <Agenda />
      </section>

      {/* 2 — Реальная доходность */}
      <section id="returns" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">2</span><span className="fc-sec-t">Реальная доходность: прогноз vs факт</span></div>
        <div className="fc-sec-d">
          Заливка факта: <b className="qc-pos">зелёным</b> — знак совпал с прогнозом, <b className="qc-neg">красным</b> — нет.
          Наведите на ячейку — увидите ошибку прогноза. Колонка «Вселенная EW» — равновзвешенный рынок.
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
            {gran === 'year' ? 'Прогноз ИБ — годовой; факт — за год.' : 'Раскадровка: факт по кварталам (компаундируется в год), прогноз ИБ годовой — ориентир в шапке года.'}
          </span>
        </div>
        <ForecastMatrix granularity={gran} />
      </section>

      {/* 3 — Оценка */}
      <section id="assess" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">3</span><span className="fc-sec-t">Оценка: сигнал → результат</span></div>

        <div className="qc-panel-h" style={{ marginTop: 4 }}>3.1 · Предсказательная сила по странам</div>
        <div className="fc-sec-d">Где прогноз ИБ несёт сигнал, а где — шум или систематический оптимизм.</div>
        <SkillTable />

        <div className="qc-panel-h" style={{ marginTop: 18 }}>3.2 · Сигнал → результат (матрица ошибок)</div>
        <div className="fc-sec-d">Знак прогноза × знак факта по всем ячейкам. Главное — прирост точности над базовой частотой роста.</div>
        <ConfusionMatrix />

        <div className="qc-panel-h" style={{ marginTop: 18 }}>3.3 · Вайт-лист vs вся вселенная</div>
        <div className="fc-sec-d">Стоит ли отбирать страны по прогнозу — или держать всё равновесно.</div>
        <div className="qc-controls-bar">
          <div className="fc-ctrl-grp">
            <span className="lbl">Правило отбора</span>
            <div className="qc-seg">
              <button className={ruleKind === 'topK' ? 'on' : ''} onClick={() => setRuleKind('topK')}>Топ-K</button>
              <button className={ruleKind === 'threshold' ? 'on' : ''} onClick={() => setRuleKind('threshold')}>Порог</button>
            </div>
          </div>
          {ruleKind === 'topK' ? (
            <div className="fc-ctrl-grp">
              <span className="lbl">K</span>
              <input className="qc-input fc-num" type="number" min={1} max={COUNTRIES.length} value={k}
                onChange={(e) => setK(Math.max(1, Math.min(COUNTRIES.length, Number(e.target.value) || 1)))} />
              <span className="qc-mut">из {COUNTRIES.length} стран/год</span>
            </div>
          ) : (
            <div className="fc-ctrl-grp">
              <span className="lbl">Прогноз ≥</span>
              <input className="qc-input fc-num" type="number" min={0} max={20} step={1} value={minPct}
                onChange={(e) => setMinPct(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
              <span className="qc-mut">%</span>
            </div>
          )}
        </div>
        <WhitelistVsUniverse rule={rule} />
      </section>

      {/* 4 — AI-резюме */}
      <section id="ai" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">4</span><span className="fc-sec-t">AI-резюме</span></div>
        <div className="fc-sec-d">Текстовый вывод после математической оценки явления.</div>
        <AiSummary rule={rule} />
      </section>
    </main>
  );
}
