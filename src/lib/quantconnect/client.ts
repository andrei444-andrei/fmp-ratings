// Клиент QuantConnect API v2 (server-only — использует node:crypto и креды из БД).
// Аутентификация: SHA-256 от `${API_TOKEN}:${unixTimestamp}`, затем HTTP Basic
// (`${userId}:${hash}` в base64) + заголовок `Timestamp`. Все запросы — POST/JSON.
// Док: https://www.quantconnect.com/docs/v2/cloud-platform/api-reference/authentication

import { createHash } from 'node:crypto';
import { getCreds, type QcCreds } from './creds';
import type { QcProject, QcBacktestSummary, QcSeriesPoint } from './types';

const QC_BASE = 'https://www.quantconnect.com/api/v2';

function authHeaders(creds: QcCreds): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hash = createHash('sha256').update(`${creds.apiToken}:${timestamp}`).digest('hex');
  const basic = Buffer.from(`${creds.userId}:${hash}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    Timestamp: timestamp,
    'Content-Type': 'application/json',
  };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function qcPost<T = any>(path: string, body: Record<string, any>, creds?: QcCreds): Promise<T> {
  const c = creds || (await getCreds());
  if (!c) throw new Error('QuantConnect креды не заданы (введите в /admin/quantconnect)');
  const res = await fetch(`${QC_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(c),
    body: JSON.stringify(body || {}),
    cache: 'no-store',
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`QuantConnect ${path}: невалидный ответ (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const msg = (Array.isArray(data?.errors) && data.errors.join('; ')) || data?.message || `HTTP ${res.status}`;
    throw new Error(`QuantConnect ${path}: ${msg}`);
  }
  if (data && data.success === false) {
    const msg = Array.isArray(data.errors) && data.errors.length ? data.errors.join('; ') : 'неуспешный ответ (success=false)';
    throw new Error(`QuantConnect ${path}: ${msg}`);
  }
  return data as T;
}

// Проверка кредов. true — авторизация прошла.
export async function qcAuthenticate(creds?: QcCreds): Promise<boolean> {
  const data = await qcPost('/authenticate', {}, creds);
  return data?.success !== false;
}

// Список всех проектов (пустое тело → все). Для выпадающего поиска.
export async function qcListProjects(): Promise<QcProject[]> {
  const data = await qcPost('/projects/read', {});
  const arr = Array.isArray(data?.projects) ? data.projects : [];
  return arr.map((p: any) => ({
    projectId: Number(p.projectId),
    name: String(p.name ?? ''),
    language: p.language ? String(p.language) : undefined,
    created: p.created != null ? String(p.created) : undefined,
    modified: p.modified != null ? String(p.modified) : undefined,
  }));
}

// Список бектестов проекта. Документированный эндпоинт — /backtests/list,
// со страховочным фолбэком на старый /backtests/read (тоже отдаёт { backtests }).
export async function qcListBacktests(projectId: number | string): Promise<QcBacktestSummary[]> {
  const pid = Number(projectId);
  let data: any;
  try {
    data = await qcPost('/backtests/list', { projectId: pid, includeStatistics: false });
  } catch {
    data = await qcPost('/backtests/read', { projectId: pid });
  }
  const arr = Array.isArray(data?.backtests) ? data.backtests : [];
  return arr.map((b: any) => {
    const status = b.status != null ? String(b.status) : '';
    return {
      backtestId: String(b.backtestId),
      name: String(b.name ?? ''),
      status,
      created: b.created ?? undefined,
      progress: typeof b.progress === 'number' ? b.progress : undefined,
      completed: /completed/i.test(status) || b.completed === true,
    };
  });
}

// Нормализуем массив values (candle [t,o,h,l,c] / line [t,y] / {x,y}|{x,close})
// в точки {t,v}. v — close (последний элемент) для свечей, y для линий.
function extractSeries(chart: any, preferred: string): QcSeriesPoint[] {
  const series = chart?.series ?? chart?.Series;
  if (!series || typeof series !== 'object') return [];
  let s: any = series[preferred];
  if (!s) {
    const keys = Object.keys(series);
    const k = keys.find(kk => kk.toLowerCase() === preferred.toLowerCase()) || keys[0];
    s = k ? series[k] : null;
  }
  const values = s?.values ?? s?.Values;
  if (!Array.isArray(values)) return [];
  const out: QcSeriesPoint[] = [];
  for (const v of values) {
    let t: number, val: number;
    if (Array.isArray(v)) {
      t = Number(v[0]);
      val = Number(v[v.length - 1]); // close для свечи, y для линии
    } else if (v && typeof v === 'object') {
      t = Number(v.x ?? v.time ?? v.t);
      val = Number(v.close ?? v.y ?? v.value ?? v.c);
    } else {
      continue;
    }
    if (!isFinite(t) || !isFinite(val)) continue;
    out.push({ t, v: val });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Читает временной ряд графика бектеста (напр. «Strategy Equity» / «Benchmark»).
// Эндпоинт может вернуть status=loading, пока график строится — ретраим.
export async function qcReadSeries(
  projectId: number | string,
  backtestId: string,
  chartName: string,
  preferredSeries: string,
  count = 10000,
): Promise<QcSeriesPoint[]> {
  const body = {
    projectId: Number(projectId),
    backtestId: String(backtestId),
    name: chartName,
    count,
    start: 0,
    end: Math.floor(Date.now() / 1000),
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const data = await qcPost('/backtests/chart/read', body);
    const chart = data?.chart ?? data?.Chart;
    if (chart && (chart.series || chart.Series)) {
      return extractSeries(chart, preferredSeries);
    }
    const loading = /load/i.test(String(data?.status ?? '')) || (typeof data?.progress === 'number' && data.progress < 1);
    if (!loading) return [];
    await sleep(1500);
  }
  return [];
}
