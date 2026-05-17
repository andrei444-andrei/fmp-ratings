import { NextRequest } from 'next/server';
import { fmpHistoricalPriceEod } from '@/lib/fmp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HORIZONS = [1, 2, 3, 4, 5, 6, 7, 14, 21, 42, 63];

type Signal = { date: string; symbol: string };
type PriceBar = { date: string; close: number };

// POST /api/signals/evaluate
// body: {
//   signals: [{date, symbol}, ...],
//   benchmark?: string,
//   excludeSignalDay?: boolean,
//   mode?: 'cumulative' | 'specific',
//   fromYear?: number,
//   toYear?: number,
// }
// Стримит NDJSON: каждая строка — JSON-объект {type:'start'|'row'|'done'|'error', ...}
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const signalsRaw: Signal[] = Array.isArray(body.signals) ? body.signals : [];
  const benchmark: string | null = body.benchmark && typeof body.benchmark === 'string'
    ? body.benchmark.trim().toUpperCase()
    : null;
  const excludeSignalDay: boolean = !!body.excludeSignalDay;
  const mode: 'cumulative' | 'specific' = body.mode === 'specific' ? 'specific' : 'cumulative';
  const fromYear: number | null = Number.isFinite(body.fromYear) ? Number(body.fromYear) : null;
  const toYear: number | null = Number.isFinite(body.toYear) ? Number(body.toYear) : null;

  const signals = signalsRaw
    .map(s => ({
      date: String(s.date || '').slice(0, 10),
      symbol: String(s.symbol || '').trim().toUpperCase(),
    }))
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.symbol)
    .filter(s => {
      const y = parseInt(s.date.slice(0, 4));
      if (fromYear != null && y < fromYear) return false;
      if (toYear != null && y > toYear) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      const cache = new Map<string, PriceBar[]>();
      async function getPrices(sym: string): Promise<PriceBar[]> {
        if (cache.has(sym)) return cache.get(sym)!;
        try {
          const data = await fmpHistoricalPriceEod(sym);
          const rows = Array.isArray(data) ? data : (data?.historical || []);
          const norm: PriceBar[] = rows
            .map((r: any) => ({
              date: String(r.date || '').slice(0, 10),
              close: typeof r.price === 'number' ? r.price
                : typeof r.adjClose === 'number' ? r.adjClose
                : typeof r.close === 'number' ? r.close
                : NaN,
            }))
            .filter((r: PriceBar) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.close))
            .sort((a: PriceBar, b: PriceBar) => a.date.localeCompare(b.date));
          cache.set(sym, norm);
          return norm;
        } catch {
          cache.set(sym, []);
          return [];
        }
      }

      send({ type: 'start', total: signals.length, horizons: HORIZONS, mode, excludeSignalDay, benchmark });

      const benchPrices = benchmark ? await getPrices(benchmark) : [];
      if (benchmark && !benchPrices.length) {
        send({ type: 'warning', message: `Не удалось загрузить цены бенчмарка ${benchmark}` });
      }

      let processed = 0;
      for (const sig of signals) {
        try {
          const symPrices = await getPrices(sig.symbol);
          if (!symPrices.length) {
            send({
              type: 'row',
              date: sig.date,
              symbol: sig.symbol,
              error: 'нет цен',
              symbolReturns: emptyHorizons(),
              benchmarkReturns: benchmark ? emptyHorizons() : null,
            });
          } else {
            const symbolReturns = computeReturns(symPrices, sig.date, excludeSignalDay, mode);
            const benchmarkReturns = benchmark && benchPrices.length
              ? computeReturns(benchPrices, sig.date, excludeSignalDay, mode)
              : null;
            send({
              type: 'row',
              date: sig.date,
              symbol: sig.symbol,
              symbolReturns,
              benchmarkReturns,
            });
          }
        } catch (e: any) {
          send({
            type: 'row',
            date: sig.date,
            symbol: sig.symbol,
            error: e?.message || 'ошибка',
            symbolReturns: emptyHorizons(),
            benchmarkReturns: benchmark ? emptyHorizons() : null,
          });
        }
        processed++;
        if (processed % 10 === 0) send({ type: 'progress', processed, total: signals.length });
      }

      send({ type: 'done', processed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

function emptyHorizons(): Record<string, number | null> {
  const o: Record<string, number | null> = {};
  for (const h of HORIZONS) o[`d${h}`] = null;
  return o;
}

// Найти наименьший индекс с prices[i].date >= signalDate.
function findStartIdx(prices: PriceBar[], signalDate: string): number {
  let lo = 0, hi = prices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].date >= signalDate) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function computeReturns(
  prices: PriceBar[],
  signalDate: string,
  excludeSignalDay: boolean,
  mode: 'cumulative' | 'specific',
): Record<string, number | null> {
  const out = emptyHorizons();
  const idx0 = findStartIdx(prices, signalDate);
  if (idx0 >= prices.length) return out;
  const baseIdx = idx0 + (excludeSignalDay ? 1 : 0);
  if (baseIdx >= prices.length) return out;
  const basePrice = prices[baseIdx].close;
  if (!(basePrice > 0)) return out;

  for (const h of HORIZONS) {
    const endIdx = baseIdx + h;
    if (endIdx >= prices.length) { out[`d${h}`] = null; continue; }
    const endPrice = prices[endIdx].close;
    if (!(endPrice > 0)) { out[`d${h}`] = null; continue; }
    if (mode === 'cumulative') {
      out[`d${h}`] = endPrice / basePrice - 1;
    } else {
      const prevIdx = endIdx - 1;
      if (prevIdx < baseIdx) { out[`d${h}`] = null; continue; }
      const prev = prices[prevIdx].close;
      if (!(prev > 0)) { out[`d${h}`] = null; continue; }
      out[`d${h}`] = endPrice / prev - 1;
    }
  }
  return out;
}
