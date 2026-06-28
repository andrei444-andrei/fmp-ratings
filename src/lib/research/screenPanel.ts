import { gzipSync, gunzipSync } from 'node:zlib';
import { libsqlClient } from '@/db/client';
import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { runSignalStudy } from '@/lib/signals/runner';
import { buildStudyCode } from '@/lib/signals/studies';
import { normalizeStudyConfig } from '@/lib/signals/config';
import { assembleUniverse, splitEngineResult, type TickerObs, type TickerPanel } from '@/lib/signals/screenAssemble';

// Кэш ПОДГОТОВЛЕННЫХ панелей сделок ПО ТИКЕРУ (чтобы скринер тянул данные с бэка мгновенно, без Pyodide
// на каждый запрос). Вселенная собирается из кэша тикеров в Node; считаем (Pyodide) только недостающие.
// Точка-в-времени: наблюдения сэмплированы движком; цены обновляются раз в день → TTL.

export { assembleUniverse, splitEngineResult };
export type { TickerObs, TickerPanel };

const TTL_MS = 24 * 3600 * 1000;
// Версия раскладки/семантики наблюдения (obs). v2 добавила форвардные исходы [ret,exc,mfe,mae,mdd];
// v3 обрезала MFE/MAE по 0 и сделала exc сырым; v4/v5 расширили набор факторов (финансовые периоды:
// momentum/xbench 5..252, vol 10..126, sma 20..200, rsi 7/14/21, dist_ath 0/63/252).
// Несовместимые старые строки игнорируются на чтении и пересчитываются.
const SCHEMA_VERSION = 'v5';

let ensured = false;
export async function ensureScreenPanelTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS screen_panel (
    symbol TEXT NOT NULL,
    horizon INTEGER NOT NULL,
    cols TEXT NOT NULL,
    payload TEXT NOT NULL,
    first TEXT, last TEXT,
    ver TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, horizon)
  )`);
  // Миграция для таблиц, созданных до появления колонки ver (ошибку «duplicate column» игнорируем).
  await libsqlClient.execute(`ALTER TABLE screen_panel ADD COLUMN ver TEXT`).catch(() => {});
  ensured = true;
}

function pack(obs: TickerObs[]): string {
  return 'gz:' + gzipSync(Buffer.from(JSON.stringify(obs), 'utf8')).toString('base64');
}
function unpack(s: string): TickerObs[] {
  if (s.startsWith('gz:')) return JSON.parse(gunzipSync(Buffer.from(s.slice(3), 'base64')).toString('utf8'));
  return JSON.parse(s);
}

// Свежие закэшированные тикеры (created_at в пределах TTL).
export async function getCachedTickers(symbols: string[], horizon: number): Promise<Map<string, TickerPanel>> {
  await ensureScreenPanelTable();
  const out = new Map<string, TickerPanel>();
  if (!symbols.length) return out;
  const ph = symbols.map(() => '?').join(',');
  const r = await libsqlClient.execute({
    sql: `SELECT symbol, cols, payload, first, last, created_at FROM screen_panel WHERE horizon=? AND ver=? AND symbol IN (${ph})`,
    args: [horizon, SCHEMA_VERSION, ...symbols],
  });
  const now = Date.now();
  for (const row of r.rows as any[]) {
    const ts = Date.parse(String(row.created_at).replace(' ', 'T') + (String(row.created_at).includes('Z') ? '' : 'Z'));
    if (Number.isFinite(ts) && now - ts > TTL_MS) continue; // устарело
    try {
      out.set(String(row.symbol), { cols: JSON.parse(String(row.cols)), obs: unpack(String(row.payload)), first: String(row.first || ''), last: String(row.last || '') });
    } catch { /* битая строка — перепосчитается */ }
  }
  return out;
}

export async function saveTickerPanels(horizon: number, cols: string[], perTicker: Map<string, TickerObs[]>): Promise<void> {
  await ensureScreenPanelTable();
  if (!perTicker.size) return;
  const now = new Date().toISOString();
  const colsJson = JSON.stringify(cols);
  const stmts = [...perTicker.entries()].map(([symbol, obs]) => ({
    sql: `INSERT INTO screen_panel (symbol,horizon,cols,payload,first,last,ver,created_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(symbol,horizon) DO UPDATE SET cols=excluded.cols, payload=excluded.payload, first=excluded.first, last=excluded.last, ver=excluded.ver, created_at=excluded.created_at`,
    args: [symbol, horizon, colsJson, pack(obs), String(obs[0]?.[0] ?? ''), String(obs[obs.length - 1]?.[0] ?? ''), SCHEMA_VERSION, now] as (string | number)[],
  }));
  for (let i = 0; i < stmts.length; i += 200) await libsqlClient.batch(stmts.slice(i, i + 200));
}

async function fetchPricesFor(symbols: string[]) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 25 * 365 * 864e5).toISOString().slice(0, 10);
  const out: { symbol: string; date: string; close: number; volume: number | null }[] = [];
  const syms = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  for (let i = 0; i < syms.length; i += 6) {
    await Promise.all(syms.slice(i, i + 6).map(async (sym) => {
      let s = await getPrices(sym, from, to);
      if (s.length < 5) s = syntheticSeries(sym); // без ключей / e2e — синтетика
      for (const r of s) out.push({ symbol: sym, date: r.date, close: r.close, volume: r.volume ?? null });
    }));
  }
  return out;
}

// Считает (Pyodide) панель сделок по набору тикеров и КЭШИРУЕТ её по тикеру. ≤40 за вызов (лимит screen).
export async function computeAndCache(symbols: string[], horizon: number): Promise<{ cols: string[]; perTicker: Map<string, TickerObs[]> } | { error: string }> {
  if (!symbols.length) return { cols: [], perTicker: new Map() };
  const cfg = normalizeStudyConfig({ mode: 'screen', universe: symbols.slice(0, 40), benchmark: 'SPY', horizon });
  const code = buildStudyCode(Buffer.from(JSON.stringify(cfg)).toString('base64'));
  let res: any = null;
  try { res = JSON.parse((await runSignalStudy(code, fetchPricesFor)) || '{}'); } catch { return { error: 'Движок вернул некорректный ответ.' }; }
  if (res?.error) return { error: String(res.error) };
  if (res?.mode !== 'screen') return { error: 'Движок не вернул панель.' };
  const split = splitEngineResult(res);
  await saveTickerPanels(horizon, split.cols, split.perTicker).catch(() => {});
  return split;
}
