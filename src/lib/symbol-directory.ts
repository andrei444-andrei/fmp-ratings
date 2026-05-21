// Проверка «является ли строка реальным тикером» через FMP search-symbol,
// с кэшем результата в Turso (libSQL). Схема создаётся лениво (CREATE TABLE
// IF NOT EXISTS), сбой создания/проверки не валит запрос — без ключа/при
// ошибке кандидаты просто считаются невалидными (graceful: текст без ссылок).

import { libsqlClient } from '@/db/client';
import { fmpSearchSymbol } from './fmp';

// Невалидные результаты перепроверяем не чаще, чем раз в неделю
// (тикер мог появиться на бирже). Валидные считаем постоянными.
const RECHECK_INVALID_MS = 7 * 24 * 3600 * 1000;

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS symbol_directory (
    symbol TEXT PRIMARY KEY,
    valid INTEGER NOT NULL,
    checked_at INTEGER NOT NULL
  )`);
  ensured = true;
}

async function readCache(symbols: string[]): Promise<Map<string, { valid: boolean; checkedAt: number }>> {
  const out = new Map<string, { valid: boolean; checkedAt: number }>();
  if (!symbols.length) return out;
  const placeholders = symbols.map(() => '?').join(',');
  const r = await libsqlClient.execute({
    sql: `SELECT symbol, valid, checked_at FROM symbol_directory WHERE symbol IN (${placeholders})`,
    args: symbols,
  });
  for (const row of r.rows || []) {
    out.set(String(row.symbol), { valid: Number(row.valid) === 1, checkedAt: Number(row.checked_at) });
  }
  return out;
}

async function writeCache(symbol: string, valid: boolean): Promise<void> {
  await libsqlClient.execute({
    sql: `INSERT INTO symbol_directory (symbol, valid, checked_at) VALUES (?, ?, ?)
          ON CONFLICT(symbol) DO UPDATE SET valid = excluded.valid, checked_at = excluded.checked_at`,
    args: [symbol, valid ? 1 : 0, Date.now()],
  });
}

// Точная сверка: тикер валиден, если FMP search-symbol возвращает запись
// с ровно таким symbol (без учёта регистра).
async function checkOne(symbol: string): Promise<boolean> {
  const data = await fmpSearchSymbol(symbol, 10);
  const arr: any[] = Array.isArray(data) ? data : [];
  return arr.some(r => String(r.symbol || '').toUpperCase() === symbol);
}

// Возвращает подмножество кандидатов, которые являются реальными тикерами.
export async function filterValidSymbols(candidates: string[]): Promise<string[]> {
  const uniq = [...new Set(candidates.map(s => s.toUpperCase().trim()).filter(Boolean))].slice(0, 60);
  if (!uniq.length) return [];

  try {
    await ensureSchema();
  } catch (e) {
    console.error('[symbol-directory] ensureSchema failed', e);
    return [];
  }

  let cache: Map<string, { valid: boolean; checkedAt: number }>;
  try {
    cache = await readCache(uniq);
  } catch (e) {
    console.error('[symbol-directory] readCache failed', e);
    cache = new Map();
  }

  const now = Date.now();
  const valid = new Set<string>();
  const toCheck: string[] = [];
  for (const s of uniq) {
    const c = cache.get(s);
    if (c && (c.valid || now - c.checkedAt < RECHECK_INVALID_MS)) {
      if (c.valid) valid.add(s);
    } else {
      toCheck.push(s);
    }
  }

  if (toCheck.length) {
    const results = await Promise.allSettled(toCheck.map(s => checkOne(s)));
    await Promise.allSettled(results.map((res, i) => {
      const sym = toCheck[i];
      if (res.status === 'fulfilled') {
        if (res.value) valid.add(sym);
        return writeCache(sym, res.value);
      }
      // Ошибка проверки (нет ключа/таймаут) — не кэшируем, считаем невалидным.
      console.error('[symbol-directory] check failed', sym, (res as PromiseRejectedResult).reason);
      return Promise.resolve();
    }));
  }

  return [...valid];
}
