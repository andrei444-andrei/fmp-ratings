import { getPortfolio, type PortfolioConfig } from '@/lib/research/portfolios';
import { getSetup } from '@/lib/research/setups';
import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { buildPortfolio, type Bar, type EngineSetup, type PricePanel, type Signal } from '@/lib/research/portfolioEngine';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Считает метрики и кривую капитала портфеля по СИГНАЛАМ сетапов и дневным ценам. Принимает либо
// сохранённый портфель ({id}), либо ad-hoc {setupIds, execution, ladderN, parking}. Ряды цен (тикеры
// сигналов + SPY + BIL) грузятся через кэш-слой getPrices (§6); без ключей — детерминированная
// синтетика (§5/§6). Срок удержания задаёт ИСПОЛНЕНИЕ, не горизонт сетапа.
const MAX_SYMBOLS = 200;
const toBars = (rows: { date: string; close: number }[]): Bar[] => rows.map((r) => ({ date: r.date, close: r.close }));

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({} as any));

    let cfg: PortfolioConfig | null = null;
    if (b?.id) {
      const p = await getPortfolio(String(b.id));
      if (p) cfg = p.config;
    }
    if (!cfg) {
      const setupIds = Array.isArray(b?.setupIds) ? b.setupIds.map((x: any) => String(x)).filter(Boolean) : [];
      const parking = b?.parking === 'SPY' ? 'SPY' : b?.parking === 'CASH' ? 'CASH' : 'BIL';
      const execution = b?.execution === 'weekly' ? 'weekly' : b?.execution === 'monthly' ? 'monthly' : 'ladder';
      const ln = Number(b?.ladderN);
      cfg = { setupIds, selection: 'all', execution, ladderN: Number.isFinite(ln) && ln > 0 ? Math.min(60, Math.round(ln)) : 5, parking };
    }
    if (!cfg.setupIds.length) return Response.json({ error: 'нужен непустой список сетапов' }, { status: 400 });

    // сетапы с потоками → сигналы входа (date, symbol)
    const setupRows = (await Promise.all(cfg.setupIds.slice(0, 40).map((id) => getSetup(id)))).filter(Boolean) as NonNullable<
      Awaited<ReturnType<typeof getSetup>>
    >[];
    const engineSetups: EngineSetup[] = setupRows.map((s) => {
      const signals: Signal[] = (s.stream || [])
        .map((d) => ({ date: String(d[0]), symbol: String(d[1]).toUpperCase() }))
        .filter((x) => x.date && x.symbol);
      return { id: s.id, name: s.name, signals };
    });

    const names = engineSetups.map((s) => s.name);
    const allDates = engineSetups.flatMap((s) => s.signals.map((x) => x.date)).filter(Boolean).sort();
    if (!allDates.length) return Response.json({ error: 'у выбранных сетапов нет сигналов (поток пуст)' }, { status: 400 });
    const from = allDates[0];
    const to = new Date().toISOString().slice(0, 10);

    // уникальные тикеры сигналов
    const symbols = [...new Set(engineSetups.flatMap((s) => s.signals.map((x) => x.symbol)))];
    const truncated = symbols.length > MAX_SYMBOLS;
    const useSymbols = symbols.slice(0, MAX_SYMBOLS);

    // SPY (календарь/бенчмарк/паркинг), BIL (если паркинг BIL), и панель цен по тикерам
    const spyRowsRaw = await getPrices('SPY', from, to).catch(() => [] as any[]);
    const synthetic = !(spyRowsRaw && spyRowsRaw.length >= 2);
    const spy = synthetic ? toBars(syntheticSeries('SPY')) : toBars(spyRowsRaw);
    let bil: Bar[] | null = null;
    if (cfg.parking === 'BIL') {
      const bilRows = await getPrices('BIL', from, to).catch(() => [] as any[]);
      if (bilRows && bilRows.length >= 2) bil = toBars(bilRows);
    }
    // панель цен по тикерам; считаем, у скольких имён реальных данных нет (фолбэк на синтетику)
    const synthSyms: string[] = [];
    const panelEntries = await Promise.all(
      useSymbols.map(async (sym) => {
        const rows = await getPrices(sym, from, to).catch(() => [] as any[]);
        if (rows && rows.length >= 2) return [sym, toBars(rows)] as const;
        synthSyms.push(sym);
        return [sym, toBars(syntheticSeries(sym))] as const;
      }),
    );
    const panel: PricePanel = new Map(panelEntries);

    const result = buildPortfolio(engineSetups, cfg, spy, bil, panel);
    if (!result || result.metrics.nSignals === 0) {
      return Response.json({ error: 'сигналы вне доступного ценового диапазона — нет данных для расчёта' }, { status: 400 });
    }
    return Response.json({
      result,
      meta: {
        setups: names, execution: cfg.execution, ladderN: cfg.ladderN, parking: cfg.parking,
        synthetic, syntheticSymbols: synthSyms.length, truncatedSymbols: truncated ? symbols.length - MAX_SYMBOLS : 0,
      },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/portfolios/compute', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
