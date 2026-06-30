import { libsqlClient } from '@/db/client';

// «Сетап» — сохранённая находка скринера как отдельная сущность: РЕЦЕПТ (вселенная + условия + горизонт +
// окно), СНИМОК цифр на момент сохранения и ПОТОК сделок во времени. Поток несёт ЗНАЧЕНИЯ ФАКТОРНЫХ КОЛОНОК
// НА ДАТУ ВХОДА (streamCols) — для будущего раздела «Портфели»: отбор «топ-K экстремальных значений» из имён,
// прошедших условия сетапа, БЕЗ look-ahead (исходы ret/exc/… — будущее, по ним ранжировать нельзя).
// Навсегда в Turso, created_at обязателен (§1). Зеркало корзин/пресетов: config/snapshot/stream — JSON в колонках.

export type SetupConfig = { uniText?: string; group?: string; blocks?: unknown[]; display?: string[]; horizon?: number; years?: number; view?: 'all' | 'tickers' | 'years' };
export type SetupSnapshot = Record<string, number | string>;
// Элемент потока: [date, symbol, ret, exc, mfe, mae, mdd, ...значения streamCols на дату входа].
// Индексы 0–1 — ключи; 2–6 — БУДУЩИЕ исходы (ранжировать по ним = look-ahead!); 7+ — факторы на входе (ранжируемые).
export type SetupDeal = (string | number | null)[];
export type SetupRow = { id: string; name: string; description: string; config: SetupConfig; snapshot: SetupSnapshot; stream?: SetupDeal[]; streamCols?: string[] };

const MAX_STREAM = 8000; // верхняя граница длины потока сделок в строке (BLOB не раздуваем)
const MAX_COLS = 40;

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

// Поток поддерживает 2 формата JSON (без миграции схемы, §1):
//   v1 — голый массив сделок [date,symbol,ret,exc,mfe,mae,mdd] (старые сетапы, без факторов → streamCols=[]);
//   v2 — { ver:2, cols, deals } со значениями факторных колонок на дату входа (для ранжирования топ-K).
function parseStream(s: string): { stream: SetupDeal[]; streamCols: string[] } {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return { stream: v as SetupDeal[], streamCols: [] };
    if (v && Array.isArray(v.deals)) return { stream: v.deals as SetupDeal[], streamCols: Array.isArray(v.cols) ? v.cols.map(String) : [] };
  } catch { /* битый — пустой поток */ }
  return { stream: [], streamCols: [] };
}

// Список — БЕЗ потока (он тяжёлый и нужен только разделу «Портфели»).
export async function listSetups(): Promise<SetupRow[]> {
  await ensureSetupsTable();
  const r = await libsqlClient.execute(`SELECT id, name, description, config, snapshot FROM research_setups ORDER BY created_at ASC`);
  return (r.rows as any[]).map((x) => ({
    id: String(x.id), name: String(x.name), description: String(x.description ?? ''),
    config: parseJson(String(x.config), {} as SetupConfig), snapshot: parseJson(String(x.snapshot), {} as SetupSnapshot),
  }));
}

// Один сетап ВМЕСТЕ с потоком сделок и колонками факторов на входе (контракт для движка «Портфели»:
// по каждой сделке date=stream[i][0], symbol=stream[i][1], значение колонки col = stream[i][7 + streamCols.indexOf(col)]).
export async function getSetup(id: string): Promise<SetupRow | null> {
  await ensureSetupsTable();
  const r = await libsqlClient.execute({ sql: `SELECT id, name, description, config, snapshot, stream FROM research_setups WHERE id=?`, args: [String(id)] });
  const x = r.rows[0] as any;
  if (!x) return null;
  const ps = parseStream(String(x.stream));
  return {
    id: String(x.id), name: String(x.name), description: String(x.description ?? ''),
    config: parseJson(String(x.config), {} as SetupConfig), snapshot: parseJson(String(x.snapshot), {} as SetupSnapshot),
    stream: ps.stream, streamCols: ps.streamCols,
  };
}

export async function upsertSetup(s: { id: string; name: string; description?: string; config: any; snapshot?: any; stream?: any; streamCols?: any }): Promise<void> {
  await ensureSetupsTable();
  const id = String(s.id).slice(0, 80);
  const name = String(s.name).trim().slice(0, 64);
  const description = String(s.description ?? '').trim().slice(0, 512);
  if (!id || !name) throw new Error('id и name обязательны');
  const config = s.config && typeof s.config === 'object' ? s.config : {};
  const snapshot = s.snapshot && typeof s.snapshot === 'object' ? s.snapshot : {};
  const deals = Array.isArray(s.stream) ? s.stream.slice(0, MAX_STREAM) : [];
  const cols = Array.isArray(s.streamCols) ? s.streamCols.map(String).slice(0, MAX_COLS) : [];
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO research_setups (id, name, description, config, snapshot, stream, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, config=excluded.config, snapshot=excluded.snapshot, stream=excluded.stream, updated_at=excluded.updated_at`,
    args: [id, name, description, JSON.stringify(config), JSON.stringify(snapshot), JSON.stringify({ ver: 2, cols, deals }), now, now],
  });
}

export async function deleteSetup(id: string): Promise<void> {
  await ensureSetupsTable();
  await libsqlClient.execute({ sql: `DELETE FROM research_setups WHERE id=?`, args: [String(id)] });
}
