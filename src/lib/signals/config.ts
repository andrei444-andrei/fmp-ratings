// Нормализация/валидация конфига исследования (недоверенный ввод с клиента → безопасный объект
// для Python). Три режима: factor (свип), signal (событийный анализ), combine (комбинация).

import { FACTORS, FACTOR_BY_ID, supportsSkip, type FactorId, type Side, type SignalDef } from './factors';

// Допускаем иностранные тикеры: ведущая цифра (Токио 7203.T), суффикс биржи (.WA, .HK), до 14 симв.
const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,13}$/;

function clampNum(v: unknown, dflt: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

// Вселенную НЕ подставляем по умолчанию — её выбирает пользователь целенаправленно.
// Пустой/невалидный список → пустая вселенная (движок вернёт понятную ошибку «мало данных»).
function normUniverse(raw: unknown, benchmark: string, max: number): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [
    ...new Set(
      arr
        .map((s) => String(s).toUpperCase().trim())
        .filter((s) => TICKER.test(s) && s !== benchmark),
    ),
  ].slice(0, max);
}

function normNumberList(raw: unknown, fallback: number[], max: number, min = -1e6, hi = 1e6): number[] {
  const arr = Array.isArray(raw) ? raw : fallback;
  const out = [...new Set(arr.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= min && x <= hi))];
  out.sort((a, b) => a - b);
  return (out.length ? out : fallback).slice(0, max);
}

// Группы вселенной (для раздельных таблиц по классам активов в режиме factor).
// Каждая группа может иметь СВОЙ бенчмарк (иностранные акции vs локальный рынок).
function normGroups(raw: unknown, benchmark: string): { label: string; tickers: string[]; benchmark: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; tickers: string[]; benchmark: string }[] = [];
  for (const g of raw.slice(0, 8)) {
    const gg = g as any;
    const label = typeof gg?.label === 'string' && gg.label.trim() ? gg.label.trim().slice(0, 60) : 'Группа';
    const gbench = typeof gg?.benchmark === 'string' && TICKER.test(gg.benchmark.toUpperCase().trim())
      ? gg.benchmark.toUpperCase().trim()
      : benchmark;
    const tickers = normUniverse(gg?.tickers, gbench, 520);
    if (tickers.length) out.push({ label, tickers, benchmark: gbench });
  }
  return out;
}

// Регион ячейки сетки (для операций над множествами): перцентиль (топ/дно %), порог (≥/≤) или диапазон.
function normRegion(reg: any, bins: string): Record<string, unknown> | null {
  const side = String(reg?.side || '');
  if (bins === 'quantile') {
    if (side !== 'pct_low' && side !== 'pct_high') return null;
    const q = clampNum(reg?.q, NaN, 0.1, 50);
    return Number.isFinite(q) ? { side, q } : null;
  }
  if (side === 'band') {
    let lo = clampNum(reg?.lo, NaN, -1e9, 1e9);
    let hi = clampNum(reg?.hi, NaN, -1e9, 1e9);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (lo > hi) [lo, hi] = [hi, lo];
    return { side, lo, hi };
  }
  if (side === 'low' || side === 'high') {
    const t = clampNum(reg?.threshold, NaN, -1e9, 1e9);
    return Number.isFinite(t) ? { side, threshold: t } : null;
  }
  return null;
}

function normSignal(raw: any): SignalDef | null {
  const f = FACTOR_BY_ID[String(raw?.factor)];
  if (!f) return null;
  const param = f.paramOptions.includes(Number(raw?.param)) ? Number(raw.param) : f.defaultParams[0];
  const side: Side = raw?.side === 'low' || raw?.side === 'high' || raw?.side === 'band' ? raw.side : f.defaultSide;
  const skip = supportsSkip(f.id)
    ? Math.round(clampNum(raw?.skip, 0, 0, Math.max(0, param - 1)))
    : 0;
  if (side === 'band') {
    let lo = clampNum(raw?.lo, f.defaultThresholds[0], -1e6, 1e6);
    let hi = clampNum(raw?.hi, f.defaultThresholds[f.defaultThresholds.length - 1], -1e6, 1e6);
    if (lo > hi) [lo, hi] = [hi, lo];
    return { factor: f.id as FactorId, param, side, lo, hi, skip };
  }
  const threshold = clampNum(raw?.threshold, f.defaultThresholds[0], -1e6, 1e6);
  return { factor: f.id as FactorId, param, side, threshold, skip };
}

// Фильтр выборки (factor): исключить/оставить наблюдения по ВТОРИЧНОМУ фактору (напр. vol(21) ≥ 30).
// Параметр СВОБОДНЫЙ (не из paramOptions) — движок считает factor_series для любого целого окна.
function normFilter(raw: any): Record<string, unknown> | null {
  if (!raw || raw.enabled === false) return null;
  const f = FACTOR_BY_ID[String(raw?.factor)];
  if (!f) return null;
  const param = Math.round(clampNum(raw?.param, f.defaultParams[0], 2, 504));
  const side: Side = raw?.side === 'low' || raw?.side === 'band' ? raw.side : 'high';
  const op = raw?.op === 'keep' ? 'keep' : 'exclude';
  const skip = supportsSkip(f.id) ? Math.round(clampNum(raw?.skip, 0, 0, Math.max(0, param - 1))) : 0;
  if (side === 'band') {
    let lo = clampNum(raw?.lo, 0, -1e6, 1e6);
    let hi = clampNum(raw?.hi, 0, -1e6, 1e6);
    if (lo > hi) [lo, hi] = [hi, lo];
    return { factor: f.id, param, side, lo, hi, op, skip };
  }
  const threshold = clampNum(raw?.threshold, 0, -1e6, 1e6);
  return { factor: f.id, param, side, threshold, op, skip };
}

export type StudyConfig = Record<string, unknown> & { mode: 'factor' | 'signal' | 'combine' | 'setops' | 'cellobs' | 'ma' | 'maops' | 'naaim' | 'corr' | 'switch' | 'switch_auto' | 'screen' };

export function normalizeStudyConfig(body: any): StudyConfig {
  const mode = ['factor', 'signal', 'combine', 'setops', 'cellobs', 'ma', 'maops', 'naaim', 'corr', 'switch', 'switch_auto', 'screen'].includes(body?.mode) ? body.mode : 'factor';
  const benchmark = (typeof body?.benchmark === 'string' && body.benchmark.trim() ? body.benchmark : 'SPY')
    .toUpperCase()
    .trim();
  const universe = normUniverse(body?.universe, benchmark, 520);
  const horizon = Math.round(clampNum(body?.horizon, 5, 1, 63));
  const dre = /^\d{4}-\d{2}-\d{2}/;
  const start = typeof body?.start === 'string' && dre.test(body.start) ? body.start.slice(0, 10) : undefined;
  const end = typeof body?.end === 'string' && dre.test(body.end) ? body.end.slice(0, 10) : undefined;
  const base: StudyConfig = { mode, benchmark, universe, horizon, start, end };

  if (mode === 'factor') {
    const f = FACTOR_BY_ID[String(body?.factor)] || FACTOR_BY_ID.xbench;
    // Свип всегда односторонний (high/low); диапазоны строит режим bins='range' из тех же порогов.
    const side: Side = body?.side === 'low' ? 'low' : body?.side === 'high' ? 'high' : f.defaultSide === 'low' ? 'low' : 'high';
    const params = normNumberList(body?.params, f.defaultParams, 6).filter((p) => f.paramOptions.includes(p));
    // Раздельные таблицы по классам активов: каждая выбранная группа считается отдельно.
    const groups = normGroups(body?.groups, benchmark);
    // Вселенная для загрузки = тикеры всех групп + бенчмарки групп (нужны для расчёта избытка).
    const factorUniverse = groups.length
      ? [...new Set([...groups.flatMap((g) => g.tickers), ...groups.map((g) => g.benchmark)])].slice(0, 520)
      : universe;
    const bins = body?.bins === 'range' ? 'range' : body?.bins === 'quantile' ? 'quantile' : 'cumulative';
    // В режиме перцентилей пороги — это размеры хвоста в % (дно/топ), 0.1..50; иначе значения фактора.
    const thresholds = bins === 'quantile'
      ? normNumberList(body?.thresholds, [2, 5, 10, 25], 20, 0.1, 50)
      : normNumberList(body?.thresholds, f.defaultThresholds, 40);
    return {
      ...base,
      universe: factorUniverse,
      factor: f.id,
      side,
      bins,
      params: params.length ? params : f.defaultParams,
      thresholds,
      fdrAlpha: clampNum(body?.fdrAlpha, 0.1, 0.01, 0.5),
      skip: Math.round(clampNum(body?.skip, 0, 0, 60)),
      outcome: body?.outcome === 'alpha' ? 'alpha' : 'excess', // исход: превышение vs β-альфа
      filter: normFilter(body?.filter), // фильтр выборки (исключить/оставить по вторичному фактору)
      groups: groups.length ? groups : undefined,
    };
  }

  if (mode === 'signal') {
    const sig = normSignal(body?.signal) || { factor: 'momentum', param: 5, side: 'low', threshold: -5 };
    return { ...base, signal: sig };
  }

  if (mode === 'screen') {
    // Скринер: панель сделок по вселенной (до 40 тикеров — больше нечитаемо/тяжело). Условия — на клиенте.
    return { ...base, universe: normUniverse(body?.universe, '', 40) };
  }

  if (mode === 'corr') {
    // Матрица корреляций активов (полная + по годам) + моментум-оверлей. Бенчмарк не выкидываем
    // (можно включить SPY как актив). Капим 40 — больше нечитаемо в матрице.
    const uni = normUniverse(body?.universe, '', 40);
    const freq = body?.freq === 'w' ? 'w' : body?.freq === 'm' ? 'm' : 'd'; // дн/нед/мес доходности
    const momWindow = Math.round(clampNum(body?.momWindow, 126, 21, 504)); // окно трейлинг-моментума, дн.
    const basketN = Math.round(clampNum(body?.basketN, 5, 2, 12)); // размер low-corr корзины
    const lev = clampNum(body?.lev, 2, 1, 5); // плечо для справочного пересчёта
    return { ...base, universe: uni, freq, momWindow, basketN, lev };
  }

  if (mode === 'naaim') {
    // Оценка форвардной альфы инструмента (по умолч. SPY = benchmark) на трёх правилах NAAIM.
    // Пороги настраиваемы (дефолты — из постановки задачи). Сам недельный ряд NAAIM движку
    // подкладывает роут (async-фетч) — здесь его нет. Вход — точка-в-времени, см. движок.
    const r1 = {
      enabled: body?.r1?.enabled !== false,
      lookbackW: Math.round(clampNum(body?.r1?.lookbackW, 52, 8, 260)), // окно перцентиля, недель
      pct: clampNum(body?.r1?.pct, 10, 1, 50), // «нижние N%»
    };
    const r2 = {
      enabled: body?.r2?.enabled !== false,
      level: clampNum(body?.r2?.level, 80, -250, 250), // NAAIM выше …
      riseW: Math.round(clampNum(body?.r2?.riseW, 4, 1, 26)), // за … недель
      riseBy: clampNum(body?.r2?.riseBy, 15, 0, 250), // вырос минимум на … пунктов
    };
    const r3 = {
      enabled: body?.r3?.enabled !== false,
      level: clampNum(body?.r3?.level, 100, -250, 250), // NAAIM выше …
    };
    const entryLag = Math.round(clampNum(body?.entryLag, 0, 0, 10)); // доп. торговых дней после след. дня
    return { ...base, instrument: benchmark, r1, r2, r3, entryLag };
  }

  if (mode === 'ma') {
    // Доходность след. дня при цене выше/ниже SMA/EMA (окна 10/20/50/100/200). Доп. параметров нет.
    // Бенчмарк для ma не используется → НЕ выкидываем его из вселенной (можно анализировать сам SPY).
    return { ...base, universe: normUniverse(body?.universe, '', 520) };
  }

  if (mode === 'maops') {
    // Комбинация условий выше/ниже MA: пересечение/исключение. conds=[{type,window,side}], op.
    const wins = [10, 20, 50, 100, 200];
    const conds = (Array.isArray(body?.conds) ? body.conds : [])
      .slice(0, 8)
      .map((c: any) => {
        const type = c?.type === 'ema' ? 'ema' : 'sma';
        const window = wins.includes(Number(c?.window)) ? Number(c.window) : null;
        const side = c?.side === 'below' ? 'below' : c?.side === 'above' ? 'above' : null;
        return window != null && side ? { type, window, side } : null;
      })
      .filter((c: unknown): c is { type: string; window: number; side: string } => c != null);
    const op = ['and', 'or', 'diff', 'xor'].includes(body?.op) ? body.op : 'and';
    return { ...base, universe: normUniverse(body?.universe, '', 520), conds, op };
  }

  if (mode === 'setops') {
    const f = FACTOR_BY_ID[String(body?.factor)] || FACTOR_BY_ID.xbench;
    const bins = body?.bins === 'range' ? 'range' : body?.bins === 'quantile' ? 'quantile' : 'cumulative';
    const op = ['or', 'and', 'diff', 'xor'].includes(body?.op) ? body.op : 'and';
    const skip = Math.round(clampNum(body?.skip, 0, 0, 60));
    // Ячейки одной группы: {param ∈ paramOptions, region}. Порядок сохраняем — для diff важно (A — первая).
    const cells = (Array.isArray(body?.cells) ? body.cells : [])
      .slice(0, 8)
      .map((c: any) => {
        const param = f.paramOptions.includes(Number(c?.param)) ? Number(c.param) : null;
        const region = normRegion(c?.region, bins);
        return param != null && region ? { param, region } : null;
      })
      .filter((c: unknown): c is { param: number; region: Record<string, unknown> } => c != null);
    return { ...base, factor: f.id, bins, op, skip, cells };
  }

  if (mode === 'cellobs') {
    // Дрилл-даун одной ячейки: сырые наблюдения (дата×тикер) за конкретный год — «осознать эффект».
    const f = FACTOR_BY_ID[String(body?.factor)] || FACTOR_BY_ID.xbench;
    const bins = body?.bins === 'range' ? 'range' : body?.bins === 'quantile' ? 'quantile' : 'cumulative';
    const skip = Math.round(clampNum(body?.skip, 0, 0, 60));
    const param = f.paramOptions.includes(Number(body?.cell?.param)) ? Number(body.cell.param) : f.defaultParams[0];
    const region = normRegion(body?.cell?.region, bins);
    const year = Math.round(clampNum(body?.year, 0, 1900, 2100));
    return { ...base, factor: f.id, bins, skip, cell: region ? { param, region } : null, year };
  }

  // switch / switch_auto — «когда держать A вместо B». Цель = форвардная доходность A − B.
  // Условие (фактор) считается на состоянии субъекта: 'a' (кандидат), 'b' (инкумбент) или 'mkt' (рынок=бенчмарк).
  if (mode === 'switch' || mode === 'switch_auto') {
    const normTk = (v: unknown, dflt: string): string => {
      const s = String(v ?? '').toUpperCase().trim();
      return TICKER.test(s) ? s : dflt;
    };
    const a = normTk(body?.a, '');
    const b = normTk(body?.b, '');
    // Вселенная для загрузки = обе бумаги пары; рынок (benchmark) main() добавит сам.
    const swBase = { ...base, universe: [a, b].filter(Boolean), a, b };

    if (mode === 'switch') {
      const f = FACTOR_BY_ID[String(body?.factor)] || FACTOR_BY_ID.momentum;
      const subject = body?.subject === 'a' || body?.subject === 'b' || body?.subject === 'mkt' ? body.subject : 'mkt';
      const side: Side = body?.side === 'low' ? 'low' : body?.side === 'high' ? 'high' : f.defaultSide === 'low' ? 'low' : 'high';
      const params = normNumberList(body?.params, f.defaultParams, 6).filter((p) => f.paramOptions.includes(p));
      const thresholds = normNumberList(body?.thresholds, f.defaultThresholds, 40);
      const skip = supportsSkip(f.id) ? Math.round(clampNum(body?.skip, 0, 0, 60)) : 0;
      return {
        ...swBase,
        factor: f.id,
        subject,
        side,
        params: params.length ? params : f.defaultParams,
        thresholds,
        skip,
        fdrAlpha: clampNum(body?.fdrAlpha, 0.1, 0.01, 0.5),
      };
    }

    // switch_auto — полный скан фактор × период × порог × сторона на выбранных субъектах.
    // Защита от переобучения: отбор на train (70%) + подтверждение на holdout test (30%) + FDR.
    const allSubjects = ['a', 'b', 'mkt'];
    const subjects = Array.isArray(body?.subjects) ? allSubjects.filter((s) => body.subjects.includes(s)) : allSubjects;
    const allFactorIds = FACTORS.map((f) => f.id as string);
    const defaultScan = ['momentum', 'xbench', 'xvol', 'vol', 'dist_ath', 'sma_dist'];
    const picked = Array.isArray(body?.factors) ? allFactorIds.filter((f) => body.factors.includes(f)) : defaultScan;
    const factors = picked.length ? picked : defaultScan;
    // Сетки порогов/периодов берём из реестра факторов (единый источник правды) и передаём в Python.
    const grids = factors.map((fid) => {
      const f = FACTOR_BY_ID[fid];
      return { factor: f.id, params: f.defaultParams, thresholds: f.defaultThresholds, defaultSide: f.defaultSide };
    });
    return {
      ...swBase,
      subjects: subjects.length ? subjects : allSubjects,
      factors,
      grids,
      minN: Math.round(clampNum(body?.minN, 24, 5, 5000)),
      topK: Math.round(clampNum(body?.topK, 12, 3, 50)),
      fdrAlpha: clampNum(body?.fdrAlpha, 0.1, 0.01, 0.5),
      strict: ['strict', 'medium', 'loose'].includes(body?.strict) ? body.strict : 'strict', // уровень отбора робастных правил
    };
  }

  // combine
  const rawSignals = Array.isArray(body?.signals) ? body.signals : [];
  const signals = rawSignals.map(normSignal).filter((x: SignalDef | null) => x != null).slice(0, 3) as SignalDef[];
  const f0 = signals[0] ? FACTOR_BY_ID[signals[0].factor] : FACTOR_BY_ID.xbench;
  const f1 = signals[1] ? FACTOR_BY_ID[signals[1].factor] : FACTOR_BY_ID.vol;
  return {
    ...base,
    signals,
    grid0: normNumberList(body?.grid0, f0.defaultThresholds, 8),
    grid1: normNumberList(body?.grid1, f1.defaultThresholds, 8),
    minN: Math.round(clampNum(body?.minN, 30, 5, 5000)),
    folds: Math.round(clampNum(body?.folds, 4, 2, 8)),
  };
}
