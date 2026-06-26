import { getCachedTickers, assembleUniverse, computeAndCache } from '@/lib/research/screenPanel';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Фикс. набор столбцов панели (как в движке screen) — фолбэк, если кэш пуст и компьют ничего не дал.
const SCREEN_COLS = ['momentum_21', 'momentum_63', 'momentum_126', 'momentum_252', 'vol_21', 'vol_63', 'dist_ath_0', 'xbench_63', 'sma_dist_50', 'sma_dist_200', 'rsi_14'];

// Подготовленная панель сделок по вселенной: кэш-первым (мгновенно), Pyodide — только на недостающие тикеры.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const universe = (Array.isArray(body?.universe) ? body.universe : [])
      .map((s: any) => String(s).toUpperCase().trim()).filter(Boolean).slice(0, 40) as string[];
    const horizon = Math.max(1, Math.min(63, Math.round(Number(body?.horizon) || 21)));
    if (!universe.length) return Response.json({ error: 'Пустая вселенная.' }, { status: 400 });

    const cached = await getCachedTickers(universe, horizon);
    const missing = universe.filter((s) => !cached.has(s));
    let cols = [...cached.values()][0]?.cols || SCREEN_COLS;
    let source: 'cache' | 'partial' | 'computed' = 'cache';

    if (missing.length) {
      source = cached.size ? 'partial' : 'computed';
      const r = await computeAndCache(missing, horizon);
      if ('error' in r) return Response.json({ error: r.error }, { status: 500 });
      cols = r.cols.length ? r.cols : cols;
      for (const [s, obs] of r.perTicker) cached.set(s, { cols: r.cols, obs, first: '', last: '' });
    }

    const panel = assembleUniverse(universe, horizon, cached, cols);
    return Response.json({ ...panel, mode: 'screen', source });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/panel', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
