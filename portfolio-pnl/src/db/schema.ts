import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// Класс актива. Соответствует сегментам продукта.
export type AssetClass = 'public' | 'private' | 'real_estate' | 'crypto' | 'cash';

// Тир ликвидности — для «Профиля ликвидности».
//   t0     — мгновенно (cash)
//   t7     — до недели (публичные рынки)
//   t90    — до квартала (часть крипты / медленные инструменты)
//   locked — заблокировано (RE / PE)
export type LiquidityTier = 't0' | 't7' | 't90' | 'locked';

// Источник записи — для аудита и подсветки «AI/ручное/CSV».
export type HoldingSource = 'manual' | 'csv' | 'ai';

// Один holding = позиция в конкретном квартале.
// Net worth квартала = сумма value по всем holdings этого квартала.
export const holdings = sqliteTable('holdings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Квартал в формате YYYYQn, например 2026Q1. Сортируется лексикографически верно.
  quarter: text('quarter').notNull(),
  assetClass: text('asset_class').notNull(),
  name: text('name').notNull(),
  symbol: text('symbol'),
  quantity: real('quantity'),
  // Рыночная стоимость позиции в USD на конец квартала.
  value: real('value').notNull(),
  // Себестоимость (для расчёта нереализованного P&L), если известна.
  costBasis: real('cost_basis'),
  account: text('account'),
  liquidityTier: text('liquidity_tier'),
  source: text('source').notNull().default('manual'),
  // Исходная сырая строка (CSV/текст) — для отладки AI-парсинга.
  raw: text('raw'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
}, t => ({
  quarterIdx: index('idx_holdings_quarter').on(t.quarter),
  classIdx: index('idx_holdings_class').on(t.assetClass),
}));

// Денежные потоки квартала: пополнения, выводы, доход (рента/дивы/купоны).
// Нужны для KPI «Чистые взносы» и «Доход за период», а также для TWR/MWR.
export type CashflowType = 'contribution' | 'withdrawal' | 'income';

export const cashflows = sqliteTable('cashflows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quarter: text('quarter').notNull(),
  type: text('type').notNull(),
  assetClass: text('asset_class'),
  amount: real('amount').notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
}, t => ({
  quarterIdx: index('idx_cashflows_quarter').on(t.quarter),
}));

// Метаданные сегмента: целевая аллокация и дата последней оценки (для алертов).
export const segmentMeta = sqliteTable('segment_meta', {
  assetClass: text('asset_class').primaryKey(),
  targetPct: real('target_pct'),
  lastValuedAt: text('last_valued_at'),
  benchmark: text('benchmark'),
});
