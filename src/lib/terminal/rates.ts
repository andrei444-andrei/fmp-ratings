// Кривая доходности и макро-ставки (идея #1). Источник — FMP treasury-rates (дневные ставки
// казначейства США). DXY/HY — прокси через getPrices (UUP/HYG). Snapshot-кэш (§6), graceful:
// нет ключа/эндпоинта → синтетическая кривая + флаг synthetic (как везде в терминале).
import { fmpTreasury } from '@/lib/fmp';
import { getPrices } from '@/lib/research/prices';
import { logAppError } from '@/lib/app-errors';
import { readSnapshot, writeSnapshot, isFresh } from './store';

const RATES_KEY = 'rates_v1';

// какие точки кривой показываем (label → поле FMP)
const CURVE: { label: string; field: string }[] = [
  { label: '3M', field: 'month3' },
  { label: '6M', field: 'month6' },
  { label: '1Y', field: 'year1' },
  { label: '2Y', field: 'year2' },
  { label: '5Y', field: 'year5' },
  { label: '10Y', field: 'year10' },
  { label: '30Y', field: 'year30' },
];

export type CurvePoint = { label: string; today: number | null; prior: number | null };
export type RatesData = {
  asOf: string;
  curve: CurvePoint[];
  tenY: number | null;
  tenYChg: number | null; // д/д, бп
  spread10_2: number | null; // бп
  spread10_3m: number | null; // бп
  dxy: { last: number | null; chg21: number | null } | null;
  hy21: number | null; // 21д доходность HYG, % (падает → спреды расширяются)
  synthetic: boolean;
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/** 21-дневная доходность ряда цен (%), null если истории мало. */
async function pct21(sym: string): Promise<{ last: number | null; chg21: number | null }> {
  try {
    const rows = await getPrices(sym, isoDaysAgo(60), isoDaysAgo(0));
    if (rows && rows.length > 22) {
      const last = rows[rows.length - 1].close;
      const prev = rows[rows.length - 22].close;
      return { last, chg21: prev > 0 ? ((last - prev) / prev) * 100 : null };
    }
  } catch {
    /* graceful */
  }
  return { last: null, chg21: null };
}

function syntheticRates(): RatesData {
  // правдоподобная слегка нормализованная кривая (демо)
  const base: Record<string, number> = { '3M': 4.55, '6M': 4.42, '1Y': 4.2, '2Y': 4.05, '5Y': 4.1, '10Y': 4.25, '30Y': 4.5 };
  const curve = CURVE.map((c) => ({ label: c.label, today: base[c.label], prior: base[c.label] - 0.08 }));
  return {
    asOf: isoDaysAgo(0),
    curve,
    tenY: 4.25,
    tenYChg: -3,
    spread10_2: 20,
    spread10_3m: -30,
    dxy: { last: 104.2, chg21: 0.6 },
    hy21: 1.2,
    synthetic: true,
  };
}

/** Полный расчёт макро-ставок. Тяжёлый — кэшируется снапшотом. */
export async function computeRates(): Promise<RatesData> {
  let rows: any[] = [];
  try {
    const raw = await fmpTreasury(isoDaysAgo(50), isoDaysAgo(0));
    rows = Array.isArray(raw) ? raw : [];
  } catch (e: any) {
    await logAppError({ route: '/api/market/rates', message: `treasury fetch failed: ${e?.message || e}` });
  }
  if (!rows.length) {
    const [dxy, hy] = await Promise.all([pct21('UUP'), pct21('HYG')]);
    const syn = syntheticRates();
    // если хотя бы прокси-цены реальны — подставим их
    if (dxy.last != null) { syn.dxy = dxy; syn.synthetic = true; }
    if (hy.chg21 != null) syn.hy21 = hy.chg21;
    return syn;
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latest = rows[rows.length - 1];
  const prevDay = rows[rows.length - 2] ?? latest;
  const priorIdx = Math.max(0, rows.length - 22); // ~21 торг. день назад
  const prior = rows[priorIdx];

  const curve: CurvePoint[] = CURVE.map((c) => ({ label: c.label, today: num(latest[c.field]), prior: num(prior[c.field]) }));
  const y10 = num(latest.year10);
  const y2 = num(latest.year2);
  const m3 = num(latest.month3);
  const y10prevDay = num(prevDay.year10);

  const [dxy, hy] = await Promise.all([pct21('UUP'), pct21('HYG')]);

  return {
    asOf: String(latest.date).slice(0, 10),
    curve,
    tenY: y10,
    tenYChg: y10 != null && y10prevDay != null ? Math.round((y10 - y10prevDay) * 100) : null,
    spread10_2: y10 != null && y2 != null ? Math.round((y10 - y2) * 100) : null,
    spread10_3m: y10 != null && m3 != null ? Math.round((y10 - m3) * 100) : null,
    dxy: dxy.last != null ? dxy : null,
    hy21: hy.chg21,
    synthetic: false,
  };
}

/** Snapshot-first. */
export async function getRates(): Promise<RatesData> {
  const cached = await readSnapshot<RatesData>(RATES_KEY);
  if (cached && isFresh(cached.refreshedAt)) return cached.payload;
  try {
    const fresh = await computeRates();
    await writeSnapshot(RATES_KEY, fresh, fresh.asOf);
    return fresh;
  } catch (e: any) {
    if (cached) return cached.payload;
    throw e;
  }
}
