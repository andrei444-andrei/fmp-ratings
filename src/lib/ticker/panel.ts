import { getPrices, type PriceRow } from '@/lib/research/prices';
import { getFundamentals } from '@/lib/research/fundamentals';
import { syntheticSeries } from '@/lib/research/metrics';
import { fmpBatchQuote } from '@/lib/fmp';
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

// Near-real-time точка «сегодня» из котировок (как в terminal/overview): EOD-история отстаёт на
// текущий незакрытый день, поэтому к последнему скорр. close применяем дневной % из quote.
type Quote = { chgPct: number; day: string };
async function loadQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (!process.env.FMP_API_KEY) return out; // без ключа — остаёмся на EOD (graceful)
  try {
    const rows = await fmpBatchQuote(symbols);
    for (const r of Array.isArray(rows) ? rows : []) {
      const sym = String(r?.symbol ?? '').toUpperCase();
      const chg = Number(r?.changePercentage ?? r?.changesPercentage);
      if (!sym || !Number.isFinite(chg)) continue;
      const ts = Number(r?.timestamp);
      const day = Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
      out.set(sym, { chgPct: chg, day });
    }
  } catch {
    /* эндпоинт недоступен — работаем по EOD */
  }
  return out;
}
// Подмешивает «сегодня» в ряд: уровень согласован с adjusted-историей (% от последнего close).
function spliceTodayQuote(rows: PriceRow[], q: Quote | undefined, today: string): boolean {
  if (!q || q.day !== today || rows.length === 0) return false;
  const last = rows[rows.length - 1];
  if (last.date >= today) return false; // сегодня уже есть в EOD — не дублируем
  const close = last.close * (1 + q.chgPct / 100);
  if (!Number.isFinite(close) || close <= 0) return false;
  rows.push({ date: today, close, volume: null });
  return true;
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
  live: boolean; // последняя точка — из котировки «сегодня» (near-real-time), а не закрытый EOD
  meta: { company: string | null; sector: string | null; currency: string | null; beta: number | null };
  dates: string[];
  close: number[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  factors: Record<string, (number | null)[]>;
  forwards: Record<string, (number | null)[]>;
  // Превышение бенчмарка за то же форвард-окно: ret_тикера − ret_SPY на [t, t+H].
  forwardsExc: Record<string, (number | null)[]>;
};

export async function getTickerPanel(symbol: string): Promise<TickerPanel> {
  const sym = symbol.toUpperCase().trim();
  const { from, to } = fromTo();
  const [t, spy] = await Promise.all([loadSeries(sym, from, to), loadSeries(BENCH, from, to)]);
  // near-real-time: добавляем точку «сегодня» из котировок к тикеру И бенчмарку (синтетику не трогаем).
  let live = false;
  if (!t.synthetic || !spy.synthetic) {
    const quotes = await loadQuotes([sym, BENCH]);
    if (!t.synthetic) live = spliceTodayQuote(t.rows, quotes.get(sym), to);
    if (!spy.synthetic) spliceTodayQuote(spy.rows, quotes.get(BENCH), to);
  }
  const rows = t.rows;
  const dates = rows.map((x) => x.date);
  const close = rows.map((x) => x.close);
  const spyAligned = alignTo(dates, spy.rows);

  const f = computeFactors(close, spyAligned);
  const forwards: Record<string, (number | null)[]> = {};
  const forwardsExc: Record<string, (number | null)[]> = {};
  for (const H of HORIZONS) {
    const tF = forwardReturns(close, H);
    const sF = forwardReturns(spyAligned, H);
    forwards[String(H)] = tF.map((x) => r(x));
    forwardsExc[String(H)] = tF.map((v, i) =>
      v != null && sF[i] != null && Number.isFinite(sF[i] as number) ? r((v as number) - (sF[i] as number)) : null,
    );
  }

  const fund = await getFundamentals([sym]).catch(() => []);
  const meta = fund[0] || null;

  const round = (a: (number | null)[]) => a.map((x) => r(x));
  return {
    symbol: sym,
    ok: rows.length >= 60,
    synthetic: t.synthetic,
    live,
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
    forwardsExc,
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
