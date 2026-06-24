// Клиент QuantConnect API v2 (server-only — использует node:crypto и креды из БД).
// Аутентификация: SHA-256 от `${API_TOKEN}:${unixTimestamp}`, затем HTTP Basic
// (`${userId}:${hash}` в base64) + заголовок `Timestamp`. Все запросы — POST/JSON.
// Док: https://www.quantconnect.com/docs/v2/cloud-platform/api-reference/authentication

import { createHash } from 'node:crypto';
import { getCreds, type QcCreds } from './creds';
import { qcParseOrder } from './orders';
import type { QcProject, QcBacktestSummary, QcSeriesPoint, QcTrade } from './types';

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
// Эндпоинт может вернуть status=loading (график строится) ИЛИ ошибку «Error retrieving
// backtest chart, please try again later» (success=false) — оба случая транзиентные,
// ретраим. На последней попытке транзиентную ошибку пробрасываем (видна причина).
const CHART_TRANSIENT = /try again later|retrieving.*chart|чарт|too many|rate.?limit|timeout|temporarily/i;
export async function qcReadSeries(
  projectId: number | string,
  backtestId: string,
  chartName: string,
  preferredSeries: string,
  count = 10000,
  maxAttempts = 10,
): Promise<QcSeriesPoint[]> {
  const body = {
    projectId: Number(projectId),
    backtestId: String(backtestId),
    name: chartName,
    count,
    start: 0,
    end: Math.floor(Date.now() / 1000),
  };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let data: any;
    try {
      data = await qcPost('/backtests/chart/read', body);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (CHART_TRANSIENT.test(msg) && attempt < maxAttempts - 1) { await sleep(2000); continue; }
      throw e; // не транзиентная или попытки кончились — пусть причина будет видна
    }
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

export type QcFile = { name: string; content: string };

// Файлы (исходный код) проекта QuantConnect.
export async function qcReadProjectFiles(projectId: number | string): Promise<QcFile[]> {
  const data = await qcPost('/files/read', { projectId: Number(projectId) });
  const arr = Array.isArray(data?.files) ? data.files : [];
  return arr.map((f: any) => ({ name: String(f.name ?? ''), content: String(f.content ?? '') }));
}

// Статистика бектеста (Sharpe, Sortino, трейды, win-rate и т.д.).
export async function qcReadBacktest(
  projectId: number | string,
  backtestId: string,
): Promise<{ statistics: Record<string, string>; runtimeStatistics: Record<string, string> }> {
  const data = await qcPost('/backtests/read', { projectId: Number(projectId), backtestId: String(backtestId) });
  const bt = data?.backtest ?? data?.Backtest ?? {};
  const norm = (o: any): Record<string, string> => {
    const out: Record<string, string> = {};
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) out[String(k)] = String(v);
    return out;
  };
  return { statistics: norm(bt.statistics ?? bt.Statistics), runtimeStatistics: norm(bt.runtimeStatistics ?? bt.RuntimeStatistics) };
}

export type QcOrder = { symbol: string; year: number | null };

// Ордера (сделки) бектеста с пагинацией (≤100 за запрос). Капим число страниц,
// чтобы не упереться в таймаут/лимиты — для агрегации этого достаточно.
export async function qcReadBacktestOrders(
  projectId: number | string,
  backtestId: string,
  maxPages = 25,
): Promise<{ orders: QcOrder[]; capped: boolean }> {
  const out: QcOrder[] = [];
  for (let page = 0; page < maxPages; page++) {
    const start = page * 100;
    let data: any;
    try {
      data = await qcPost('/backtests/orders/read', { projectId: Number(projectId), backtestId: String(backtestId), start, end: start + 100 });
    } catch {
      return { orders: out, capped: false };
    }
    const arr = Array.isArray(data?.orders) ? data.orders : [];
    for (const o of arr) {
      const sym = o?.symbol?.value ?? o?.symbol?.Value ?? (typeof o?.symbol === 'string' ? o.symbol : '') ?? '';
      const t = o?.time ?? o?.createdTime ?? o?.lastFillTime;
      let year: number | null = null;
      if (t != null) {
        const ms = typeof t === 'number' ? (t > 1e12 ? t : t * 1000) : Date.parse(String(t));
        if (isFinite(ms)) year = new Date(ms).getUTCFullYear();
      }
      out.push({ symbol: String(sym || '?').toUpperCase(), year });
    }
    if (arr.length < 100) return { orders: out, capped: false };
  }
  return { orders: out, capped: true };
}

// Детальные сделки (ордера) бектеста: дата, инструмент, сторона, кол-во, цена, объём.
// ПОСЛЕДОВАТЕЛЬНАЯ пагинация по 100 (параллельная упиралась в rate-limit QC → 200 с
// пустыми ордерами → «нет сделок»). Идём, пока страница полная; высокий кап + бюджет
// по времени, чтобы не упереться в таймаут роута. Ошибку первой страницы пробрасываем.
export async function qcReadBacktestTrades(
  projectId: number | string,
  backtestId: string,
  maxOrders = 30000,
  timeBudgetMs = 45000,
): Promise<{ trades: QcTrade[]; capped: boolean }> {
  const pid = Number(projectId), bt = String(backtestId);
  const ordersOf = (d: any): any[] => (Array.isArray(d?.orders) ? d.orders : Array.isArray(d?.Orders) ? d.Orders : []);
  const readPage = (start: number) => qcPost('/backtests/orders/read', { projectId: pid, backtestId: bt, start, end: start + 100 });
  const t0 = Date.now();
  const out: QcTrade[] = [];

  // Первая страница с ретраем: QC под rate-limit иногда отдаёт 200 с пустыми ордерами
  // (отсюда «нет сделок» на ровном месте). Ретраим и на ошибку, и на пустоту.
  let firstArr: any[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    let data: any;
    try {
      data = await readPage(0);
    } catch (e) {
      if (attempt === 2) throw e; // реальная причина видна после ретраев
      await sleep(500); continue;
    }
    firstArr = ordersOf(data);
    if (firstArr.length > 0 || attempt === 2) break;
    await sleep(500); // пусто — вероятно rate-limit, пробуем ещё
  }
  for (const o of firstArr) out.push(qcParseOrder(o));
  if (firstArr.length < 100) return { trades: out, capped: false };

  // дальше — последовательно, пока страница полная (с бюджетом по времени)
  for (let start = 100; start < maxOrders; start += 100) {
    let arr: any[];
    try { arr = ordersOf(await readPage(start)); }
    catch { return { trades: out, capped: true }; }
    for (const o of arr) out.push(qcParseOrder(o));
    if (arr.length < 100) return { trades: out, capped: false };
    if (Date.now() - t0 > timeBudgetMs) return { trades: out, capped: true };
  }
  return { trades: out, capped: true };
}
