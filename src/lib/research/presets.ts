import { libsqlClient } from '@/db/client';

// Постоянное хранилище ПРЕСЕТОВ настроек скринера (условия отбора + столбцы + горизонт/окно/вид) — в Turso
// (навсегда). Аналогично корзинам/формулам: единая библиотека, created_at обязателен (§1). Сама конфигурация —
// JSON в одной колонке config; name/description — отдельными колонками для списка/поиска.

export type PresetConfig = {
  blocks: unknown[];
  display?: string[];
  horizon?: number;
  years?: number;
  view?: 'all' | 'tickers' | 'years';
};
export type PresetRow = { id: string; name: string; description: string; config: PresetConfig };

let ensured = false;
export async function ensurePresetsTable(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS research_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

// Нормализация конфигурации: оставляем только понятные поля; пустой/битый config → пустые блоки.
function cleanConfig(cfg: any): PresetConfig {
  const blocks = Array.isArray(cfg?.blocks) ? cfg.blocks : [];
  const out: PresetConfig = { blocks };
  if (Array.isArray(cfg?.display)) out.display = cfg.display.map((s: any) => String(s)).slice(0, 64);
  if (Number.isFinite(cfg?.horizon)) out.horizon = Math.max(1, Math.min(63, Math.round(cfg.horizon)));
  if (Number.isFinite(cfg?.years)) out.years = Math.max(1, Math.min(60, Math.round(cfg.years)));
  if (cfg?.view === 'all' || cfg?.view === 'tickers' || cfg?.view === 'years') out.view = cfg.view;
  return out;
}

function parseConfig(s: string): PresetConfig {
  try { return cleanConfig(JSON.parse(s)); } catch { return { blocks: [] }; }
}

export async function listPresets(): Promise<PresetRow[]> {
  await ensurePresetsTable();
  const r = await libsqlClient.execute(`SELECT id, name, description, config FROM research_presets ORDER BY created_at ASC`);
  return (r.rows as any[]).map((x) => ({
    id: String(x.id), name: String(x.name), description: String(x.description ?? ''), config: parseConfig(String(x.config)),
  }));
}

export async function upsertPreset(p: { id: string; name: string; description?: string; config: any }): Promise<void> {
  await ensurePresetsTable();
  const id = String(p.id).slice(0, 80);
  const name = String(p.name).trim().slice(0, 64);
  const description = String(p.description ?? '').trim().slice(0, 512);
  const config = cleanConfig(p.config);
  if (!id || !name) throw new Error('id и name обязательны');
  if (!config.blocks.length) throw new Error('пресет должен содержать хотя бы один блок условий');
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO research_presets (id, name, description, config, created_at, updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, config=excluded.config, updated_at=excluded.updated_at`,
    args: [id, name, description, JSON.stringify(config), now, now],
  });
}

export async function deletePreset(id: string): Promise<void> {
  await ensurePresetsTable();
  await libsqlClient.execute({ sql: `DELETE FROM research_presets WHERE id=?`, args: [String(id)] });
}
