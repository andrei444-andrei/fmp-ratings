import type { Obs } from './stats';
import type { CftcMarketDef } from './registry';

// CFTC Commitments of Traders — Futures Only (legacy), Socrata dataset 6dca-aqww.
// Публичный JSON, ключ не обязателен (но app token поднимает лимиты).
// Метрика: net non-commercial позиция как % от open interest.
const CFTC_RESOURCE = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json';

export async function fetchCftcNetPctOi(market: CftcMarketDef, limit = 520): Promise<Obs[]> {
  const params = new URLSearchParams();
  params.set('$select', [
    'report_date_as_yyyy_mm_dd',
    'noncomm_positions_long_all',
    'noncomm_positions_short_all',
    'open_interest_all',
  ].join(','));
  params.set('$where', `upper(market_and_exchange_names) like '${market.where}'`);
  params.set('$order', 'report_date_as_yyyy_mm_dd ASC');
  params.set('$limit', String(limit));

  const headers: Record<string, string> = {};
  const token = process.env.CFTC_APP_TOKEN;
  if (token) headers['X-App-Token'] = token;

  const url = `${CFTC_RESOURCE}?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store', headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CFTC ${res.status}: ${body.slice(0, 200)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('CFTC: unexpected response');

  const obs: Obs[] = [];
  for (const r of rows) {
    const date = r?.report_date_as_yyyy_mm_dd;
    const long = Number(r?.noncomm_positions_long_all);
    const short = Number(r?.noncomm_positions_short_all);
    const oi = Number(r?.open_interest_all);
    if (!date || !Number.isFinite(long) || !Number.isFinite(short) || !Number.isFinite(oi) || oi <= 0) continue;
    const netPctOi = (long - short) / oi * 100;
    obs.push({ date: String(date).slice(0, 10), value: netPctOi });
  }
  return obs;
}
