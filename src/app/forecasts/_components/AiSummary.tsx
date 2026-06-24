'use client';

import { useState } from 'react';
import Markdown from '../../quant/_components/Markdown';
import { allSkills, confusion, whitelistVsUniverse, mean, type SelectionRule } from '../metrics';
import { pct } from '../fmt';

// Секция 4 — AI-резюме ПОСЛЕ математической оценки.
// В прототипе кнопка «Сгенерировать» собирает текст детерминированно из уже
// посчитанных метрик (чтобы резюме совпадало с тем, что показано выше).
// В проде здесь будет вызов aimlapi (§3 конституции) с теми же метриками в промпте.

function buildSummary(rule: SelectionRule): string {
  const skills = allSkills();
  const conf = confusion();
  const wl = whitelistVsUniverse(rule);

  const trade = skills.filter((s) => s.verdict === 'trade');
  const noise = skills.filter((s) => s.verdict === 'noise');
  const lift = conf.precisionUp != null ? conf.precisionUp - conf.baseRateUp : 0;

  const avgBias = mean(skills.map((s) => s.bias));
  const biasLine =
    avgBias > 0.01
      ? `Прогнозы в среднем **оптимистичны** (прогноз выше факта на ${pct(avgBias)} в год).`
      : avgBias < -0.01
        ? `Прогнозы в среднем **консервативны** — недооценивают движение (прогноз ниже факта на ${pct(-avgBias)} в год); это типично для ралли.`
        : `Систематического смещения почти нет (${pct(avgBias)} в год).`;

  const verdictLine =
    wl.verdict === 'whitelist'
      ? `**Вывод: вайт-лист оправдан** — отбор по прогнозу дал +${pct(wl.edgeCagr)} CAGR над «держать всё».`
      : wl.verdict === 'universe'
        ? `**Вывод: вайт-лист не нужен** — отбор по прогнозу проиграл ${pct(wl.edgeCagr)} CAGR; проще держать всю вселенную.`
        : `**Вывод: ничья** — отбор по прогнозу не дал устойчивого преимущества (${pct(wl.edgeCagr)} CAGR), поэтому «держать всё» предпочтительнее как более простое и дешёвое решение.`;

  return [
    `### Резюме: прогнозы ИБ как сигнал для отбора стран`,
    ``,
    `**Предсказательная сила прогнозов в среднем слабая.** По направлению прогноз совпадает с фактом в ${(conf.accuracy * 100).toFixed(0)}% случаев, ` +
      `но рынок и без прогноза рос в ${(conf.baseRateUp * 100).toFixed(0)}% лет — чистый прирост от прогноза всего ${lift >= 0 ? '+' : '−'}${Math.abs(lift * 100).toFixed(0)} пп. ` +
      biasLine,
    ``,
    `**Сигнал неоднороден по странам.** ` +
      (trade.length ? `Похоже на сигнал: ${trade.map((s) => s.flag + ' ' + s.name).join(', ')}. ` : `Явного сигнала ни по одной стране не выделено. `) +
      (noise.length ? `Скорее шум / прогноз против факта: ${noise.map((s) => s.flag + ' ' + s.name).join(', ')}.` : ''),
    ``,
    verdictLine,
    ``,
    `**Оговорки.** Окно ${wl.universe.n} лет — статистически разница в ±1–2 пп CAGR неотличима от удачи. ` +
      `Высокий процент «попаданий» во многом объясняется тем, что рынки чаще растут, а не качеством прогноза. ` +
      `Прежде чем фиксировать вайт-лист, нужны: длиннее история, поправка на риск (σ/просадка), издержки ребаланса и проверка out-of-sample.`,
  ].join('\n');
}

export default function AiSummary({ rule }: { rule: SelectionRule }) {
  const [state, setState] = useState<'idle' | 'gen' | 'done'>('idle');
  const [text, setText] = useState('');

  function generate() {
    setState('gen');
    // имитация «обдумывания» — в проде здесь стрим ответа aimlapi
    setTimeout(() => {
      setText(buildSummary(rule));
      setState('done');
    }, 650);
  }

  return (
    <div className="fc-ai">
      <div className="fc-ai-bar">
        <button className="qc-btn primary" onClick={generate} disabled={state === 'gen'}>
          {state === 'gen' ? 'Генерация…' : state === 'done' ? '↻ Перегенерировать' : '✨ Сгенерировать резюме'}
        </button>
        <span className="fc-ai-note">прототип: текст собран из метрик выше. В проде — модель через aimlapi по тем же данным.</span>
      </div>
      {state === 'done' ? (
        <div className="fc-ai-out">
          <Markdown text={text} />
        </div>
      ) : (
        <div className="qc-panel"><div className="qc-state">
          {state === 'gen' ? 'Анализирую матрицу прогноз/факт…' : 'Нажмите «Сгенерировать», чтобы получить текстовый вывод после математической оценки.'}
        </div></div>
      )}
    </div>
  );
}
