// Анализ просадок одной стратегии (client-safe): underwater-кривая (по дням) и
// эпизоды просадок (пик → дно → восстановление) с глубиной и длительностями.

import type { DayPoint } from './types';

export type DrawdownEpisode = {
  peak: string; trough: string; recovery: string | null;
  depth: number;          // глубина (≤0)
  ddDays: number;         // пик → дно
  recoveryDays: number | null; // дно → восстановление
  lengthDays: number;     // пик → восстановление (или конец)
  recovered: boolean;
};

export type DrawdownResult = {
  dates: string[];
  underwater: number[];   // equity/peak − 1 (≤0)
  maxDD: number | null;
  episodes: DrawdownEpisode[]; // отсортированы по глубине
};

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export function computeDrawdowns(dailyIn: DayPoint[]): DrawdownResult | null {
  const daily = [...dailyIn].filter(p => isFinite(p.v) && p.v > 0).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (daily.length < 20) return null;

  const dates = daily.map(p => p.d);
  const eq = daily.map(p => p.v);
  const underwater: number[] = [];
  const episodes: DrawdownEpisode[] = [];

  let peakV = eq[0], peakI = 0;
  let inDD = false, troughV = eq[0], troughI = 0;

  for (let i = 0; i < eq.length; i++) {
    if (eq[i] >= peakV) {
      if (inDD) {
        // восстановление до прежнего пика
        episodes.push(makeEp(dates, peakI, troughI, i, peakV, troughV, true));
        inDD = false;
      }
      peakV = eq[i]; peakI = i;
    } else {
      if (!inDD) { inDD = true; troughV = eq[i]; troughI = i; }
      else if (eq[i] < troughV) { troughV = eq[i]; troughI = i; }
    }
    underwater.push(peakV > 0 ? eq[i] / peakV - 1 : 0);
  }
  if (inDD) episodes.push(makeEp(dates, peakI, troughI, null, peakV, troughV, false));

  episodes.sort((a, b) => a.depth - b.depth);
  const maxDD = episodes.length ? episodes[0].depth : null;

  return { dates, underwater, maxDD, episodes };
}

function makeEp(dates: string[], peakI: number, troughI: number, recI: number | null, peakV: number, troughV: number, recovered: boolean): DrawdownEpisode {
  const peak = dates[peakI], trough = dates[troughI];
  const recovery = recI != null ? dates[recI] : null;
  const end = recovery ?? dates[dates.length - 1];
  return {
    peak, trough, recovery,
    depth: peakV > 0 ? troughV / peakV - 1 : 0,
    ddDays: dayDiff(peak, trough),
    recoveryDays: recovery ? dayDiff(trough, recovery) : null,
    lengthDays: dayDiff(peak, end),
    recovered,
  };
}
