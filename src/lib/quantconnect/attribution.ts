// Чистые (без server-зависимостей) утилиты атрибуции — можно импортировать в клиентских
// компонентах. ВАЖНО: не тянуть сюда ./client (node:crypto) и пр. server-only модули,
// иначе клиентский бандл сломается (UnhandledSchemeError node:crypto).

// Якорим годовую атрибуцию (реконструкция из сделок, нормированная на gross-экспозицию)
// к ФАКТИЧЕСКОЙ годовой доходности из equity-кривой. Без этого у плечевых стратегий Δ к SPY
// делится на плечо и схлопывается (а в кризисы — завышается). Масштабируем долю каждого тикера
// так, чтобы Σ contrib = факт. доходность стратегии за год, а Σ excess = факт. опережение SPY.
// realStrat/realSpy === undefined (нет данных бенчмарка за год) → возвращаем исходные значения.
export function anchorYearAttribution(
  contrib: Record<string, number>,
  excess: Record<string, number>,
  realStrat: number | undefined,
  realSpy: number | undefined,
): { contrib: Record<string, number>; excess: Record<string, number>; totalContrib: number; totalExcess: number } {
  const EPS = 1e-9;
  const reconC = Object.values(contrib).reduce((s, x) => s + x, 0);
  const spyEq: Record<string, number> = {};
  for (const s of Object.keys(contrib)) spyEq[s] = contrib[s] - (excess[s] ?? 0);
  const reconS = Object.values(spyEq).reduce((s, x) => s + x, 0);
  const scaleC = realStrat != null && Math.abs(reconC) > EPS ? realStrat / reconC : 1;
  const anchorE = realStrat != null && realSpy != null;
  const scaleS = anchorE && Math.abs(reconS) > EPS ? realSpy! / reconS : 1;
  const oc: Record<string, number> = {}, oe: Record<string, number> = {};
  for (const s of Object.keys(contrib)) {
    oc[s] = contrib[s] * scaleC;
    oe[s] = anchorE ? contrib[s] * scaleC - (spyEq[s] ?? 0) * scaleS : (excess[s] ?? 0);
  }
  return {
    contrib: oc,
    excess: oe,
    totalContrib: realStrat != null ? realStrat : reconC,
    totalExcess: anchorE ? realStrat! - realSpy! : reconC - reconS,
  };
}
