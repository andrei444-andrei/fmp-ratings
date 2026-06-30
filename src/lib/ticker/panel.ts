import { getPrices, type PriceRow } from '@/lib/research/prices';
import { getFundamentals } from '@/lib/research/fundamentals';
import { syntheticSeries } from '@/lib/research/metrics';
import { computeFactors, forwardReturns, HORIZONS } from './engine';

// Серверный слой раздела «Анализ тикера». Цены — через единый кэш-первый getPrices (EODHD→FMP),
// без ключей (e2e/демо) — детерминированная синтетика. Бенчмарк SPY выравнивается по календарю тикера
// (carry-forward), факторы и форвард-доходности считаются на ПОЛНОМ ряду (один источник правды с графиком).

const BENCH = 'SPY';
const r = (x: number | null, p = 6): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** p) / 10 ** p);

function fromTo(): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 25 * 365 * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

async function loadSeries(sym: string, from: string, to: string): Promise<{ rows: PriceRow[]; synthetic: boolean }> {
  let rows = await getPrices(sym, from, to).catch(() => [] as PriceRow[]);
  if (rows.length < 60) return { rows: syntheticSeries(sym), synthetic: true };
  return { rows: rows.filter((x) => x.date >= from && x.date <= to), synthetic: false };
}

// Выравнивает бенчмарк по датам тикера (перенос последнего известного close вперёд).
function alignTo(dates: string[], bench: PriceRow[]): number[] {
  const out = new Array(dates.length).fill(NaN);
  let j = 0, last = NaN;
  for (let i = 0; i < dates.length; i++) {
    while (j < bench.length && bench[j].date <= dates[i]) { last = bench[j].close; j++; }
    out[i] = last;
  }
  return out;
}

export type TickerPanel = {
  symbol: string;
  ok: boolean;
  synthetic: boolean;
  meta: { company: string | null; sector: string | null; currency: string | null; beta: number | null };
  dates: string[];
  close: number[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  factors: Record<string, (number | null)[]>;
  forwards: Record<string, (number | null)[]>;
};

export async function getTickerPanel(symbol: string): Promise<TickerPanel> {
  const sym = symbol.toUpperCase().trim();
  const { from, to } = fromTo();
  const [t, spy] = await Promise.all([loadSeries(sym, from, to), loadSeries(BENCH, from, to)]);
  const rows = t.rows;
  const dates = rows.map((x) => x.date);
  const close = rows.map((x) => x.close);
  const spyAligned = alignTo(dates, spy.rows);

  const f = computeFactors(close, spyAligned);
  const forwards: Record<string, (number | null)[]> = {};
  for (const H of HORIZONS) forwards[String(H)] = forwardReturns(close, H).map((x) => r(x));

  const fund = await getFundamentals([sym]).catch(() => []);
  const meta = fund[0] || null;

  const round = (a: (number | null)[]) => a.map((x) => r(x));
  return {
    symbol: sym,
    ok: rows.length >= 60,
    synthetic: t.synthetic,
    meta: { company: meta?.company ?? null, sector: meta?.sector ?? null, currency: meta?.currency ?? null, beta: meta?.beta ?? null },
    dates,
    close: close.map((x) => r(x, 4) as number),
    sma50: round(f.sma50),
    sma200: round(f.sma200),
    factors: {
      distAth: round(f.distAth), smaDist50: round(f.smaDist50), smaDist200: round(f.smaDist200),
      vol21: round(f.vol21), dd21: round(f.dd21), dd63: round(f.dd63), rs63: round(f.rs63),
    },
    forwards,
  };
}

// Ряды close для виджета корреляций (настраиваемые активы). Компактно: [date, close][].
export async function getTickerSeries(symbols: string[]): Promise<Record<string, [string, number][]>> {
  const { from, to } = fromTo();
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))].slice(0, 10);
  const out: Record<string, [string, number][]> = {};
  for (let i = 0; i < uniq.length; i += 6) {
    await Promise.all(
      uniq.slice(i, i + 6).map(async (s) => {
        const { rows } = await loadSeries(s, from, to);
        out[s] = rows.map((x) => [x.date, Math.round(x.close * 1e4) / 1e4] as [string, number]);
      }),
    );
  }
  return out;
}
