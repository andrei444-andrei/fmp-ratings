'use client';

import { useState } from 'react';
import Markdown from '../../quant/_components/Markdown';
import { rankIC, owUwSpread, tierMatrix, numericMetrics, coverage, allSkills, whitelistVsUniverse, type SelectionRule } from '../metrics';
import type { CountrySeries } from '../mock';
import { pct, coef } from '../fmt';

// Секция 5 — AI-резюме ПОСЛЕ математической оценки. В прототипе текст собран
// детерминированно из посчитанных метрик. В проде — aimlapi (§3) с теми же
// метриками + цитатами источников в промпте.
function buildSummary(rule: SelectionRule, data: CountrySeries[]): string {
  const ic = rankIC(data);
  const sp = owUwSpread(data);
  const tm = tierMatrix(data);
  const num = numericMetrics(data);
  const cov = coverage(data);
  const wl = whitelistVsUniverse(rule, data);
  const skills = allSkills(data);
  const trade = skills.filter((s) => s.verdict === 'trade');
  const noise = skills.filter((s) => s.verdict === 'noise');
  const lift = tm.directionalTotal ? tm.directionalCorrect / tm.directionalTotal - tm.baseRateUp : 0;

  const verdictLine =
    wl.verdict === 'whitelist' ? `**Вывод: вайт-лист оправдан** — отбор по сигналу дал ${pct(wl.edgeCagr)} CAGR над «держать всё».`
      : wl.verdict === 'universe' ? `**Вывод: вайт-лист не нужен** — он проиграл ${pct(wl.edgeCagr)} CAGR; проще держать всю вселенную.`
        : `**Вывод: по доходности — ничья** (${pct(wl.edgeCagr)} CAGR). Ценность сигнала — не в «держать OW» (банки и так почти всегда бычьи), а в **относительном ранжировании и избегании UW**.`;

  return [
    `### Резюме: прогнозы ИБ как сигнал для отбора стран`,
    ``,
    `**Сила сигнала — слабая, но не нулевая.** Кросс-секционный Rank IC в среднем ${coef(ic.meanIC)} ` +
      `(t-стат ${ic.tStat?.toFixed(2) ?? '—'} по ${ic.kYears} годам${ic.tStat != null && Math.abs(ic.tStat) < 2 ? ', статистически незначимо' : ''}). ` +
      `Направленная точность ${tm.directionalTotal ? Math.round((tm.directionalCorrect / tm.directionalTotal) * 100) : 0}% против базы ${Math.round(tm.baseRateUp * 100)}% — ` +
      `прирост всего ${lift >= 0 ? '+' : '−'}${Math.abs(lift * 100).toFixed(0)} пп.`,
    ``,
    `**Где сигнал в относительных рейтингах.** Спред OW−UW в среднем ${pct(sp.avgSpread)} (${sp.hitYears}/${sp.validYears} лет положительный): ` +
      `то, что банки ставят в overweight, в среднем обгоняет underweight — это полезнее, чем абсолютное «рост/падение».`,
    ``,
    `**По странам.** ` +
      (trade.length ? `Похоже на сигнал: ${trade.map((s) => s.flag + ' ' + s.name).join(', ')}. ` : `Явного сигнала не выделено. `) +
      (noise.length ? `Скорее шум / против факта: ${noise.map((s) => s.flag + ' ' + s.name).join(', ')}. ` : '') +
      `Числовые прогнозы (${num.n} шт.): Pearson IC ${coef(num.ic)}, смещение ${pct(num.bias)} (${num.bias < 0 ? 'консерватизм' : 'оптимизм'}).`,
    ``,
    verdictLine,
    ``,
    `**Данные и оговорки.** Покрытие: прогноз есть в ${cov.withForecast}/${cov.cells} ячеек, факт — в ${cov.withReal}/${cov.cells}; метрики считались по ${cov.withBoth} парам, пропуски не импутированы. ` +
      `Окно ${ic.kYears} лет коротко: ±1–2 пп CAGR неотличимы от удачи. Нужны длиннее история, поправка на риск, издержки ребаланса и out-of-sample.`,
  ].join('\n');
}

export default function AiSummary({ rule, data }: { rule: SelectionRule; data: CountrySeries[] }) {
  const [state, setState] = useState<'idle' | 'gen' | 'done'>('idle');
  const [text, setText] = useState('');

  function generate() {
    setState('gen');
    setTimeout(() => { setText(buildSummary(rule, data)); setState('done'); }, 650);
  }

  return (
    <div className="fc-ai">
      <div className="fc-ai-bar">
        <button className="qc-btn primary" onClick={generate} disabled={state === 'gen'}>
          {state === 'gen' ? 'Генерация…' : state === 'done' ? '↻ Перегенерировать' : '✨ Сгенерировать резюме'}
        </button>
        <span className="fc-ai-note">прототип: текст собран из метрик выше. В проде — модель через aimlapi по тем же данным + источники.</span>
      </div>
      {state === 'done' ? (
        <div className="fc-ai-out"><Markdown text={text} /></div>
      ) : (
        <div className="qc-panel"><div className="qc-state">
          {state === 'gen' ? 'Анализирую сигналы, спред OW−UW и факт…' : 'Нажмите «Сгенерировать» — резюме появится после математической оценки.'}
        </div></div>
      )}
    </div>
  );
}
