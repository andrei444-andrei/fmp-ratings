// Пользовательские настройки терминала, сохраняемые НА СЕРВЕРЕ (Turso) — переживают
// перезагрузку и не требуют рестарта. Авторизации/пользователей нет → одна глобальная
// строка key='default'. Self-provisioning (§1), created_at, graceful без БД.
import { libsqlClient } from '@/db/client';

export type TerminalConfig = {
  /** Виджет «Нормализованный перформанс»: избранные тикеры + период. */
  compare: { symbols: string[]; period: string };
  /** Корреляционная матрица: выбранные тикеры. */
  corr: { symbols: string[] };
};

export const DEFAULT_CONFIG: TerminalConfig = {
  compare: { symbols: ['SPY', 'QQQ', 'DIA'], period: '1Г' },
  corr: { symbols: ['SPY', 'QQQ', 'MCHI', 'EWG', 'EWJ', 'GLD', 'SLV', 'URA', 'XLK', 'XLE', 'XLF'] },
};

const KEY = 'default';
let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS terminal_config (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

function sanitizeSymbols(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? '').trim().toUpperCase();
    if (s && /^[A-Z0-9.\-]{1,12}$/.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Нормализует произвольный объект к валидному TerminalConfig, подставляя дефолты. */
export function normalizeConfig(raw: any): TerminalConfig {
  const compareSyms = sanitizeSymbols(raw?.compare?.symbols, 12);
  const corrSyms = sanitizeSymbols(raw?.corr?.symbols, 16);
  const period = typeof raw?.compare?.period === 'string' ? raw.compare.period : DEFAULT_CONFIG.compare.period;
  return {
    compare: { symbols: compareSyms.length ? compareSyms : DEFAULT_CONFIG.compare.symbols, period },
    corr: { symbols: corrSyms.length ? corrSyms : DEFAULT_CONFIG.corr.symbols },
  };
}

/** Читает конфиг с сервера; дефолты при промахе/недоступной БД (graceful). */
export async function readConfig(): Promise<TerminalConfig> {
  try {
    await ensureTable();
    const r = await libsqlClient.execute({ sql: `SELECT payload FROM terminal_config WHERE key=?`, args: [KEY] });
    const row = r.rows[0] as any;
    if (!row) return DEFAULT_CONFIG;
    return normalizeConfig(JSON.parse(String(row.payload)));
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Сохраняет конфиг на сервер. Возвращает true при успехе (false — БД недоступна). */
export async function writeConfig(cfg: TerminalConfig): Promise<boolean> {
  try {
    await ensureTable();
    const now = new Date().toISOString();
    await libsqlClient.execute({
      sql: `INSERT INTO terminal_config (key, payload, updated_at, created_at) VALUES (?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
      args: [KEY, JSON.stringify(cfg), now, now],
    });
    return true;
  } catch {
    return false;
  }
}
