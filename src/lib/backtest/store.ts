import { libsqlClient } from '@/db/client';

// Self-provisioning (§1 конституции): таблицы создаются лениво, единый источник правды —
// эти CREATE. created_at обязателен (§1).
//
// Две сущности бэктеста:
//  • backtest_strategies — сохранённые СТРАТЕГИИ (переиспользуемый код + конфиг). Аналог research_prompts.
//  • backtest_runs       — РЕЗУЛЬТАТЫ прогонов (снимок HTML + конфиг + код). Привязка к стратегии (strategy_id).
//                          autosaved=1 — автосохранение (после каждого прогона), отделяется от ручных сохранений.
const MAX_AUTOSAVES = 25; // сколько последних автосохранений-прогонов держим (старые подрезаем)

let ensured = false;
export async function ensureBacktestTables(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS backtest_strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    code TEXT NOT NULL,
    config TEXT,
    chat TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`);
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS backtest_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER,
    title TEXT,
    description TEXT,
    config TEXT NOT NULL,
    strategy TEXT NOT NULL,
    status TEXT NOT NULL,
    result_html TEXT,
    error TEXT,
    autosaved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Идемпотентные миграции для БД, созданных раньше (дубль колонки тихо игнорируем).
  for (const col of ['strategy_id INTEGER', 'autosaved INTEGER NOT NULL DEFAULT 0']) {
    try {
      await libsqlClient.execute(`ALTER TABLE backtest_runs ADD COLUMN ${col}`);
    } catch {
      /* колонка уже есть */
    }
  }
  try {
    await libsqlClient.execute(`ALTER TABLE backtest_strategies ADD COLUMN chat TEXT`);
  } catch {
    /* колонка уже есть */
  }
  ensured = true;
}

// ===================== СТРАТЕГИИ =====================

export type SavedStrategyItem = { id: number; title: string | null; created_at: string };

export async function listStrategies(): Promise<SavedStrategyItem[]> {
  await ensureBacktestTables();
  const r = await libsqlClient.execute(
    `SELECT id, title, created_at FROM backtest_strategies ORDER BY id DESC LIMIT 100`,
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    created_at: String(x.created_at),
  }));
}

export type SavedStrategy = {
  id: number;
  title: string | null;
  code: string;
  config: string | null;
  chat: string | null;
  created_at: string;
};

export async function getStrategy(id: number): Promise<SavedStrategy | null> {
  await ensureBacktestTables();
  const r = await libsqlClient.execute({
    sql: `SELECT id, title, code, config, chat, created_at FROM backtest_strategies WHERE id = ?`,
    args: [id],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: Number(x.id),
    title: x.title != null ? String(x.title) : null,
    code: String(x.code),
    config: x.config != null ? String(x.config) : null,
    chat: x.chat != null ? String(x.chat) : null,
    created_at: String(x.created_at),
  };
}

export async function saveStrategy(o: {
  title: string;
  code: string;
  config?: string | null;
  chat?: string | null;
}): Promise<number> {
  await ensureBacktestTables();
  const now = new Date().toISOString();
  const r = await libsqlClient.execute({
    sql: `INSERT INTO backtest_strategies (title, code, config, chat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [o.title, o.code, o.config ?? null, o.chat ?? null, now, now],
  });
  return Number(r.lastInsertRowid ?? 0);
}

export async function updateStrategy(
  id: number,
  o: { title?: string | null; code?: string | null; config?: string | null; chat?: string | null },
): Promise<void> {
  await ensureBacktestTables();
  const sets: string[] = [];
  const args: any[] = [];
  if (o.title !== undefined) {
    sets.push('title = ?');
    args.push(o.title);
  }
  if (o.code !== undefined) {
    sets.push('code = ?');
    args.push(o.code);
  }
  if (o.config !== undefined) {
    sets.push('config = ?');
    args.push(o.config);
  }
  if (o.chat !== undefined) {
    sets.push('chat = ?');
    args.push(o.chat);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(new Date().toISOString());
  args.push(id);
  await libsqlClient.execute({ sql: `UPDATE backtest_strategies SET ${sets.join(', ')} WHERE id = ?`, args });
}

export async function deleteStrategy(id: number): Promise<void> {
  await ensureBacktestTables();
  // Каскад: вместе со стратегией удаляем её сохранённые прогоны (одной транзакцией).
  await libsqlClient.batch([
    { sql: `DELETE FROM backtest_runs WHERE strategy_id = ?`, args: [id] },
    { sql: `DELETE FROM backtest_strategies WHERE id = ?`, args: [id] },
  ]);
}

// ===================== ПРОГОНЫ (РЕЗУЛЬТАТЫ) =====================

export type SavedBacktestRunItem = {
  id: number;
  strategy_id: number | null;
  title: string | null;
  autosaved: boolean;
  created_at: string;
};

export async function listBacktestRuns(): Promise<SavedBacktestRunItem[]> {
  await ensureBacktestTables();
  const r = await libsqlClient.execute(
    `SELECT id, strategy_id, title, autosaved, created_at FROM backtest_runs ORDER BY id DESC LIMIT 200`,
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    strategy_id: x.strategy_id != null ? Number(x.strategy_id) : null,
    title: x.title != null ? String(x.title) : null,
    autosaved: Number(x.autosaved ?? 0) === 1,
    created_at: String(x.created_at),
  }));
}

export type SavedBacktestRun = {
  id: number;
  strategy_id: number | null;
  title: string | null;
  description: string | null;
  config: string;
  strategy: string;
  result_html: string | null;
  autosaved: boolean;
  created_at: string;
};

export async function getBacktestRun(id: number): Promise<SavedBacktestRun | null> {
  await ensureBacktestTables();
  const r = await libsqlClient.execute({
    sql: `SELECT id, strategy_id, title, description, config, strategy, result_html, autosaved, created_at
          FROM backtest_runs WHERE id = ?`,
    args: [id],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: Number(x.id),
    strategy_id: x.strategy_id != null ? Number(x.strategy_id) : null,
    title: x.title != null ? String(x.title) : null,
    description: x.description != null ? String(x.description) : null,
    config: String(x.config),
    strategy: String(x.strategy),
    result_html: x.result_html != null ? String(x.result_html) : null,
    autosaved: Number(x.autosaved ?? 0) === 1,
    created_at: String(x.created_at),
  };
}

export async function saveBacktestRun(o: {
  title: string;
  description?: string | null;
  config: string;
  strategy: string;
  resultHtml: string | null;
  strategyId?: number | null;
  autosaved?: boolean;
}): Promise<number> {
  await ensureBacktestTables();
  const now = new Date().toISOString();
  const autosaved = o.autosaved ? 1 : 0;
  const r = await libsqlClient.execute({
    sql: `INSERT INTO backtest_runs (strategy_id, title, description, config, strategy, status, result_html, autosaved, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [o.strategyId ?? null, o.title, o.description ?? null, o.config, o.strategy, 'saved', o.resultHtml, autosaved, now],
  });
  // Автосохранения держим в ограниченном количестве В РАМКАХ СТРАТЕГИИ — старые подрезаем (ручные не трогаем).
  if (autosaved) await pruneAutosaves(o.strategyId ?? null);
  return Number(r.lastInsertRowid ?? 0);
}

// Код прошлого (самого свежего) прогона стратегии — для авто-заголовка по diff кода.
export async function getLastRunCode(strategyId: number): Promise<string | null> {
  await ensureBacktestTables();
  const r = await libsqlClient.execute({
    sql: `SELECT strategy FROM backtest_runs WHERE strategy_id = ? ORDER BY id DESC LIMIT 1`,
    args: [strategyId],
  });
  const x = r.rows[0];
  return x?.strategy != null ? String(x.strategy) : null;
}

export async function updateBacktestRun(
  id: number,
  o: { title?: string | null; description?: string | null; strategyId?: number | null; autosaved?: boolean },
): Promise<void> {
  await ensureBacktestTables();
  const sets: string[] = [];
  const args: any[] = [];
  if (o.title !== undefined) {
    sets.push('title = ?');
    args.push(o.title);
  }
  if (o.description !== undefined) {
    sets.push('description = ?');
    args.push(o.description);
  }
  if (o.strategyId !== undefined) {
    sets.push('strategy_id = ?');
    args.push(o.strategyId);
  }
  if (o.autosaved !== undefined) {
    sets.push('autosaved = ?');
    args.push(o.autosaved ? 1 : 0);
  }
  if (!sets.length) return;
  args.push(id);
  await libsqlClient.execute({ sql: `UPDATE backtest_runs SET ${sets.join(', ')} WHERE id = ?`, args });
}

export async function deleteBacktestRun(id: number): Promise<void> {
  await ensureBacktestTables();
  await libsqlClient.execute({ sql: `DELETE FROM backtest_runs WHERE id = ?`, args: [id] });
}

// Держим не более MAX_AUTOSAVES автосохранений В РАМКАХ ОДНОЙ СТРАТЕГИИ (история по стратегии).
async function pruneAutosaves(strategyId: number | null): Promise<void> {
  if (strategyId == null) {
    await libsqlClient.execute({
      sql: `DELETE FROM backtest_runs WHERE autosaved = 1 AND strategy_id IS NULL AND id NOT IN (
              SELECT id FROM backtest_runs WHERE autosaved = 1 AND strategy_id IS NULL ORDER BY id DESC LIMIT ?
            )`,
      args: [MAX_AUTOSAVES],
    });
  } else {
    await libsqlClient.execute({
      sql: `DELETE FROM backtest_runs WHERE autosaved = 1 AND strategy_id = ? AND id NOT IN (
              SELECT id FROM backtest_runs WHERE autosaved = 1 AND strategy_id = ? ORDER BY id DESC LIMIT ?
            )`,
      args: [strategyId, strategyId, MAX_AUTOSAVES],
    });
  }
}
