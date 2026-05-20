// DDL в одном месте: используется и CLI-миграцией (src/db/migrate.ts),
// и API-роутом /api/db/migrate (для прод-БД на Turso, где нет shell-доступа).
export const DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quarter TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT,
    quantity REAL,
    value REAL NOT NULL,
    cost_basis REAL,
    account TEXT,
    liquidity_tier TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    raw TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_holdings_quarter ON holdings (quarter)`,
  `CREATE INDEX IF NOT EXISTS idx_holdings_class ON holdings (asset_class)`,
  `CREATE TABLE IF NOT EXISTS cashflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quarter TEXT NOT NULL,
    type TEXT NOT NULL,
    asset_class TEXT,
    amount REAL NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cashflows_quarter ON cashflows (quarter)`,
  `CREATE TABLE IF NOT EXISTS segment_meta (
    asset_class TEXT PRIMARY KEY,
    target_pct REAL,
    last_valued_at TEXT,
    benchmark TEXT
  )`,
];
