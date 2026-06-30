import { libsqlClient } from '@/db/client';

// «Сетап» — сохранённая находка скринера как отдельная сущность: РЕЦЕПТ (вселенная + условия + горизонт +
// окно), СНИМОК цифр на момент сохранения и ПОТОК сделок во времени (нужен будущему разделу «Стратегии»,
// чтобы комбинировать сетапы: считать их совместную кривую/просадку/корреляцию). Навсегда в Turso, created_at
// обязателен (§1). Зеркало корзин/пресетов: config/snapshot/stream — JSON в отдельных колонках.

export type SetupConfig = { uniText?: string; group?: string; blocks?: unknown[]; display?: string[]; horizon?: number; years?: number; view?: 'all' | 'tickers' | 'years' };
export type SetupSnapshot = Record<string, number | string>;
export type SetupDeal = (string | number)[]; // [date, symbol, ret, exc, mfe, mae, mdd]
export type SetupRow = { id: string; name: string; description: string; config: SetupConfig; snapshot: SetupSnapshot; stream?: SetupDeal[] };

const MAX_STREAM = 8000; // верхняя граница длины потока сделок в строке (BLOB не раздуваем)

let ensured = false;
export async function ensureSetupsTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS research_setups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL,
    snapshot TEXT NOT NULL DEFAULT '',
    stream TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

function parseJson<T>(s: string, fallback: T): T { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; } }

// Список — БЕЗ потока (он тяжёлый и нужен только разделу «Стратегии»).
export async function listSetups(): Promise<SetupRow[]> {
  await ensureSetupsTable();
  const r = await libsqlClient.execute(`SELECT id, name, description, config, snapshot FROM research_setups ORDER BY created_at ASC`);
  return (r.rows as any[]).map((x) => ({
    id: String(x.id), name: String(x.name), description: String(x.description ?? ''),
    config: parseJson(String(x.config), {} as SetupConfig), snapshot: parseJson(String(x.snapshot), {} as SetupSnapshot),
  }));
}

// Один сетап ВМЕСТЕ с потоком сделок (для будущей комбинации в стратегию).
export async function getSetup(id: string): Promise<SetupRow | null> {
  await ensureSetupsTable();
  const r = await libsqlClient.execute({ sql: `SELECT id, name, description, config, snapshot, stream FROM research_setups WHERE id=?`, args: [String(id)] });
  const x = r.rows[0] as any;
  if (!x) return null;
  return {
    id: String(x.id), name: String(x.name), description: String(x.description ?? ''),
    config: parseJson(String(x.config), {} as SetupConfig), snapshot: parseJson(String(x.snapshot), {} as SetupSnapshot),
    stream: parseJson(String(x.stream), [] as SetupDeal[]),
  };
}

export async function upsertSetup(s: { id: string; name: string; description?: string; config: any; snapshot?: any; stream?: any }): Promise<void> {
  await ensureSetupsTable();
  const id = String(s.id).slice(0, 80);
  const name = String(s.name).trim().slice(0, 64);
  const description = String(s.description ?? '').trim().slice(0, 512);
  if (!id || !name) throw new Error('id и name обязательны');
  const config = s.config && typeof s.config === 'object' ? s.config : {};
  const snapshot = s.snapshot && typeof s.snapshot === 'object' ? s.snapshot : {};
  const stream = Array.isArray(s.stream) ? s.stream.slice(0, MAX_STREAM) : [];
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO research_setups (id, name, description, config, snapshot, stream, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, config=excluded.config, snapshot=excluded.snapshot, stream=excluded.stream, updated_at=excluded.updated_at`,
    args: [id, name, description, JSON.stringify(config), JSON.stringify(snapshot), JSON.stringify(stream), now, now],
  });
}

export async function deleteSetup(id: string): Promise<void> {
  await ensureSetupsTable();
  await libsqlClient.execute({ sql: `DELETE FROM research_setups WHERE id=?`, args: [String(id)] });
}
