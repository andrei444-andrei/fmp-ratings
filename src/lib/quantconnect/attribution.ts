// Чистые (без server-зависимостей) утилиты атрибуции — можно импортировать в клиентских
// компонентах. ВАЖНО: не тянуть сюда ./client (node:crypto) и пр. server-only модули,
// иначе клиентский бандл сломается (UnhandledSchemeError node:crypto).

// Безопасный коэффициент масштабирования real/recon. Возвращает 1 (не масштабируем), если:
//  - нет факт. значения;
//  - recon-знаменатель почти нулевой (реконструкция тикеров за год взаимно сократилась —
//    несёт мало сигнала, масштаб взорвётся: 2018 у BUY DEEP Σrecon=+0.14% при факте −13.78%);
//  - разные знаки или экстремальный масштаб (>10× / <0.1×) — реконструкция за год ненадёжна
//    для разнесения по тикерам, иначе крошечные ячейки раздуваются в сотни % и меняют знак.
// «Итог» при этом всё равно берётся фактический — масштаб влияет только на ячейки тикеров.
function safeScale(real: number | undefined, recon: number): number {
  if (real == null || Math.abs(recon) < 1e-4) return 1;
  const r = real / recon;
  if (r <= 0 || r > 10 || r < 0.1) return 1;
  return r;
}

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
  const reconC = Object.values(contrib).reduce((s, x) => s + x, 0);
  const spyEq: Record<string, number> = {};
  for (const s of Object.keys(contrib)) spyEq[s] = contrib[s] - (excess[s] ?? 0);
  const reconS = Object.values(spyEq).reduce((s, x) => s + x, 0);
  const scaleC = safeScale(realStrat, reconC);
  const anchorE = realStrat != null && realSpy != null;
  const scaleS = anchorE ? safeScale(realSpy, reconS) : 1;
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
