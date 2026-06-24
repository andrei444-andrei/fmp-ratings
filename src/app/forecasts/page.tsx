'use client';

import { useCallback, useEffect, useState } from 'react';
import Agenda from './_components/Agenda';
import ForecastMatrix from './_components/ForecastMatrix';
import ResultsAnalysis from './_components/ResultsAnalysis';
import SkillTable from './_components/SkillTable';
import WhitelistVsUniverse from './_components/WhitelistVsUniverse';
import AiSummary from './_components/AiSummary';
import type { SelectionRule } from './metrics';
import { DATA, buildSeries, COUNTRIES, type SignalTier, type IngestedForecast, type CountrySeries } from './mock';

type Granularity = 'year' | 'quarter';
type RuleKind = 'tier' | 'topK';

export default function ForecastsPage() {
  const [gran, setGran] = useState<Granularity>('year');
  const [ruleKind, setRuleKind] = useState<RuleKind>('tier');
  const [minTier, setMinTier] = useState<SignalTier>(1);
  const [k, setK] = useState(6);

  // данные: null до загрузки → синтетический DATA (чтобы первый рендер не пустой)
  const [live, setLive] = useState<CountrySeries[] | null>(null);
  const [realCount, setRealCount] = useState<number | null>(null); // прогнозов в БД
  const [ingest, setIngest] = useState<{ running: boolean; remaining: number; mode: string; note: string }>(
    { running: false, remaining: 0, mode: '', note: '' },
  );

  const data = live ?? DATA;
  const rule: SelectionRule = ruleKind === 'tier' ? { kind: 'tier', min: minTier } : { kind: 'topK', k };

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/forecasts/data', { cache: 'no-store' }).then((x) => x.json());
      const rows: IngestedForecast[] = (r.forecasts || []).map((f: any) => ({
        asset: f.asset, year: f.year, bank: f.bank, format: f.format, signal: f.signal,
        expectedReturn: f.expectedReturn, quote: f.rawQuote, sourceName: f.sourceName,
        sourceUrl: f.sourceUrl, asOf: f.asOf, id: f.id, confidence: f.confidence,
        extractedBy: f.extractedBy, verified: f.verified,
      }));
      setRealCount(rows.length);
      setLive(buildSeries(rows));
    } catch {
      setRealCount(0);
      setLive(buildSeries([])); // синтетика
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Добор прогнозов: бьём /ingest батчами, пока remaining>0, обновляя матрицу.
  async function runIngest(force = false) {
    setIngest({ running: true, remaining: 0, mode: '', note: 'старт…' });
    let guard = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (guard++ < 40) {
        const res = await fetch('/api/forecasts/ingest', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 4, force: force && guard === 1 }),
        }).then((x) => x.json());
        if (res.error) { setIngest({ running: false, remaining: 0, mode: '', note: 'ошибка: ' + res.error }); return; }
        await load();
        setIngest({ running: res.remaining > 0, remaining: res.remaining, mode: res.mode, note: `обработано ещё ${res.processed}, осталось ${res.remaining}` });
        if (res.remaining <= 0) break;
      }
    } catch (e: any) {
      setIngest({ running: false, remaining: 0, mode: '', note: 'сбой сети: ' + (e?.message || '') });
      return;
    }
    setIngest((s) => ({ ...s, running: false, note: 'готово' }));
    await load();
  }

  const sourceLabel = realCount == null ? 'загрузка…' : realCount > 0 ? `реальные (кэш Sonar): ${realCount} прогнозов` : 'синтетика (мок) — нажмите «Добрать прогнозы»';

  return (
    <main>
      <div className="qc-top">
        <div className="qc-title">Прогнозы ИБ vs реальная доходность</div>
        <div className="qc-sub">Сигнал прогноза (с источником) против факта по активам. Оценка сигнала и решение — вайт-лист или держать всю вселенную.</div>
      </div>

      <div className="fc-proto">
        <span className="tag">данные: {realCount && realCount > 0 ? 'реальные' : 'мок'}</span>
        <span>
          Источник прогнозов: <b>{sourceLabel}</b>. Прогнозы тянутся веб-поиском (Perplexity Sonar) с источниками и <b>кэшируются в БД</b> — повторно поиск не гоняется.
          Факт. доходность пока синтетическая (нет ключей цен).
        </span>
      </div>

      <div className="qc-controls-bar">
        <button className="qc-btn primary" onClick={() => runIngest(false)} disabled={ingest.running}>
          {ingest.running ? `Добор… (осталось ${ingest.remaining})` : '✨ Добрать прогнозы (AI)'}
        </button>
        <button className="qc-btn" onClick={() => load()} disabled={ingest.running} title="Перечитать кэш из БД">↻ Обновить</button>
        {ingest.note && <span className="fc-ai-note">{ingest.note}{ingest.mode ? ` · режим: ${ingest.mode}` : ''}</span>}
      </div>

      <nav className="fc-toc">
        <a href="#agenda"><span className="n">1</span>Повестка</a>
        <a href="#returns"><span className="n">2</span>Сигнал vs факт</a>
        <a href="#assess"><span className="n">3</span>Анализ результата</a>
        <a href="#whitelist"><span className="n">4</span>Вайт-лист</a>
        <a href="#ai"><span className="n">5</span>AI-резюме</a>
      </nav>

      <section id="agenda" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">1</span><span className="fc-sec-t">Повестка</span></div>
        <Agenda />
      </section>

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
        <ForecastMatrix granularity={gran} data={data} />
      </section>

      <section id="assess" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">3</span><span className="fc-sec-t">Оценка: сигнал → результат</span></div>
        <div className="fc-sec-d">Насколько сигнал прогноза предсказывает факт. Первичные метрики — ранговые (устойчивы к формату и пропускам).</div>
        <ResultsAnalysis data={data} />
        <div className="qc-panel-h" style={{ marginTop: 18 }}>3.5 · Навык по активу</div>
        <SkillTable data={data} />
      </section>

      <section id="whitelist" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">4</span><span className="fc-sec-t">Вайт-лист vs вся вселенная</span></div>
        <div className="fc-sec-d">Стоит ли отбирать активы по сигналу — или держать всё равновесно.</div>
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
              <span className="qc-mut">из {COUNTRIES.length} активов/год</span>
            </div>
          )}
        </div>
        <WhitelistVsUniverse rule={rule} data={data} />
      </section>

      <section id="ai" className="fc-sec">
        <div className="fc-sec-h"><span className="fc-sec-n">5</span><span className="fc-sec-t">AI-резюме</span></div>
        <div className="fc-sec-d">Текстовый вывод после математической оценки.</div>
        <AiSummary rule={rule} data={data} />
      </section>
    </main>
  );
}
