import { getPortfolio, type PortfolioConfig } from '@/lib/research/portfolios';
import { getSetup } from '@/lib/research/setups';
import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { buildPortfolio, type Bar, type EngineSetup } from '@/lib/research/portfolioEngine';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Считает метрики и кривую капитала портфеля по потокам сделок выбранных сетапов. Принимает либо
// сохранённый портфель (?id= / {id}), либо ad-hoc {setupIds, config}. Ряды SPY/BIL грузятся через
// общий кэш-слой getPrices (§6); без ключей — детерминированная синтетика (graceful, §5/§6).
function toBars(rows: { date: string; close: number }[]): Bar[] {
  return rows.map((r) => ({ date: r.date, close: r.close }));
}
const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : NaN);

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({} as any));

    // конфигурация: из сохранённого портфеля или из тела запроса
    let cfg: PortfolioConfig | null = null;
    if (b?.id) {
      const p = await getPortfolio(String(b.id));
      if (p) cfg = p.config;
    }
    if (!cfg) {
      const setupIds = Array.isArray(b?.setupIds) ? b.setupIds.map((x: any) => String(x)).filter(Boolean) : [];
      const parking = b?.parking === 'SPY' ? 'SPY' : b?.parking === 'CASH' ? 'CASH' : 'BIL';
      const mc = Number(b?.maxConcurrent);
      cfg = { setupIds, weighting: 'equal', maxConcurrent: Number.isFinite(mc) && mc > 0 ? Math.round(mc) : null, parking };
    }
    if (!cfg.setupIds.length) return Response.json({ error: 'нужен непустой список сетапов' }, { status: 400 });

    // грузим сетапы вместе с потоками сделок
    const setupRows = (await Promise.all(cfg.setupIds.slice(0, 40).map((id) => getSetup(id)))).filter(Boolean) as NonNullable<
      Awaited<ReturnType<typeof getSetup>>
    >[];
    const engineSetups: EngineSetup[] = setupRows.map((s) => {
      const snap = s.snapshot || {};
      const rankWeight = [num((snap as any).avgExc), num((snap as any).avgRet), 0].find((x) => Number.isFinite(x)) ?? 0;
      const horizon = num((s.config as any)?.horizon) || 21;
      const deals = (s.stream || [])
        .map((d) => ({ date: String(d[0]), ret: num(d[2]) }))
        .filter((d) => d.date && Number.isFinite(d.ret));
      return { id: s.id, name: s.name, horizon, rankWeight: Number.isFinite(rankWeight) ? rankWeight : 0, deals };
    });

    const names = engineSetups.map((s) => s.name);
    const allDates = engineSetups.flatMap((s) => s.deals.map((d) => d.date)).filter(Boolean).sort();
    if (!allDates.length) {
      return Response.json({ error: 'у выбранных сетапов нет сделок (поток пуст)' }, { status: 400 });
    }
    const from = allDates[0];
    const to = new Date().toISOString().slice(0, 10);

    // SPY: календарь + бенчмарк + (опц.) паркинг; без ключей — синтетика
    let spyRows = await getPrices('SPY', from, to).catch(() => []);
    let synthetic = false;
    if (!spyRows || spyRows.length < 2) {
      spyRows = syntheticSeries('SPY');
      synthetic = true;
    }
    // BIL: только если паркинг BIL; пусто → движок откатится на кэш (0)
    let bilBars: Bar[] | null = null;
    if (cfg.parking === 'BIL') {
      const bilRows = await getPrices('BIL', from, to).catch(() => []);
      if (bilRows && bilRows.length >= 2) bilBars = toBars(bilRows);
    }

    const result = buildPortfolio(engineSetups, cfg, toBars(spyRows), bilBars);
    return Response.json({ result, meta: { setups: names, parking: cfg.parking, maxConcurrent: cfg.maxConcurrent, synthetic } });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/portfolios/compute', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
