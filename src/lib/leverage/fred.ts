import type { Obs } from './stats';

// FRED API: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
// Нужен бесплатный ключ FRED_API_KEY.
export function getFredKey(): string {
  const k = process.env.FRED_API_KEY;
  if (!k) throw new Error('FRED_API_KEY is not set');
  return k;
}

export async function fetchFredSeries(seriesId: string): Promise<Obs[]> {
  const key = getFredKey();
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: key,
    file_type: 'json',
  });
  const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FRED ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data?.error_message) throw new Error(data.error_message);
  const obs: Obs[] = [];
  for (const o of data?.observations ?? []) {
    // FRED помечает отсутствующие значения точкой
    if (!o?.date || o.value == null || o.value === '.') continue;
    const v = Number(o.value);
    if (!Number.isFinite(v)) continue;
    obs.push({ date: String(o.date).slice(0, 10), value: v });
  }
  return obs;
}
