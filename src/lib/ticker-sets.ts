// Наборы тикеров (сектора США / страны-регионы) в Turso. Редактируются в /admin/ticker-sets,
// читаются на /heatmap для блоков и пресетов. Схема создаётся лениво, сидится дефолтами.

import { libsqlClient } from '@/db/client';

export type TickerSetKind = 'sector' | 'country' | 'extra';
export type TickerSetRow = {
  id?: number;
  kind: TickerSetKind;
  label: string;
  tickers: string;     // CSV, например 'FXI,MCHI'
  sortOrder?: number;
};

const SEED: TickerSetRow[] = [
  // Сектора США
  { kind: 'sector', label: 'S&P 500', tickers: 'SPY' },
  { kind: 'sector', label: 'Nasdaq 100', tickers: 'QQQ' },
  { kind: 'sector', label: 'Russell 2000', tickers: 'IWM' },
  { kind: 'sector', label: 'Энергетика', tickers: 'XLE' },
  { kind: 'sector', label: 'Финансы', tickers: 'XLF' },
  { kind: 'sector', label: 'Технологии', tickers: 'XLK' },
  { kind: 'sector', label: 'Здравоохранение', tickers: 'XLV' },
  { kind: 'sector', label: 'Промышленность', tickers: 'XLI' },
  { kind: 'sector', label: 'Потреб. цикличный', tickers: 'XLY' },
  { kind: 'sector', label: 'Потреб. защитный', tickers: 'XLP' },
  { kind: 'sector', label: 'Коммунальные', tickers: 'XLU' },
  { kind: 'sector', label: 'Материалы', tickers: 'XLB' },
  { kind: 'sector', label: 'Недвижимость', tickers: 'XLRE' },
  { kind: 'sector', label: 'Коммуникации', tickers: 'XLC' },
  // Страны / регионы
  { kind: 'country', label: 'США', tickers: 'VTI' },
  { kind: 'country', label: 'Европа', tickers: 'VGK' },
  { kind: 'country', label: 'Китай', tickers: 'FXI' },
  { kind: 'country', label: 'Япония', tickers: 'EWJ' },
  { kind: 'country', label: 'Индия', tickers: 'INDA' },
  { kind: 'country', label: 'Корея', tickers: 'EWY' },
  // Дополнительные тикеры
  { kind: 'extra', label: 'Золото', tickers: 'GLD' },
  { kind: 'extra', label: 'Нефть', tickers: 'USO' },
  { kind: 'extra', label: 'Treasuries 20Y', tickers: 'TLT' },
];

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    tickers TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`);
  ensured = true;
  // Сидим дефолтами только если таблица пуста.
  const c = await libsqlClient.execute('SELECT COUNT(*) AS n FROM ticker_sets');
  if (Number(c.rows?.[0]?.n || 0) === 0) {
    let i = 0;
    for (const r of SEED) await upsert({ ...r, sortOrder: i++ });
  }
}

function normTickers(s: string): string {
  return s.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean).join(',');
}

export async function listSets(): Promise<TickerSetRow[]> {
  await ensureSchema();
  const r = await libsqlClient.execute(
    'SELECT id, kind, label, tickers, sort_order FROM ticker_sets ORDER BY kind, sort_order, id'
  );
  return (r.rows || []).map((row: any) => ({
    id: Number(row.id),
    kind: String(row.kind) as TickerSetKind,
    label: String(row.label),
    tickers: String(row.tickers),
    sortOrder: Number(row.sort_order),
  }));
}

export async function upsert(row: TickerSetRow): Promise<void> {
  await ensureSchema();
  const tickers = normTickers(row.tickers);
  if (!tickers || !row.label.trim()) return;
  const now = Math.floor(Date.now() / 1000);
  if (row.id) {
    await libsqlClient.execute({
      sql: `UPDATE ticker_sets SET kind=?, label=?, tickers=?, sort_order=?, updated_at=? WHERE id=?`,
      args: [row.kind, row.label.trim(), tickers, row.sortOrder ?? 0, now, row.id],
    });
  } else {
    await libsqlClient.execute({
      sql: `INSERT INTO ticker_sets (kind, label, tickers, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [row.kind, row.label.trim(), tickers, row.sortOrder ?? 0, now],
    });
  }
}

export async function remove(id: number): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute({ sql: 'DELETE FROM ticker_sets WHERE id = ?', args: [id] });
}
