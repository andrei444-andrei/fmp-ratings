import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

// Текущий состав S&P 500 (последняя загрузка из FMP /api/v3/sp500_constituent)
export const sp500Current = sqliteTable('sp500_current', {
  symbol: text('symbol').primaryKey(),
  name: text('name'),
  sector: text('sector'),
  subSector: text('sub_sector'),
  founded: text('founded'),
  fetchedAt: text('fetched_at').notNull(),
});

// История изменений S&P 500 (из /api/v3/historical/sp500_constituent)
export const sp500Changes = sqliteTable('sp500_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  addedSymbol: text('added_symbol'),
  removedSymbol: text('removed_symbol'),
  reason: text('reason'),
  raw: text('raw'),
}, t => ({
  dateIdx: index('idx_sp500_changes_date').on(t.date),
}));

// Историческая market cap (для расчёта top-N на дату)
export const marketCap = sqliteTable('market_cap', {
  symbol: text('symbol').notNull(),
  date: text('date').notNull(),
  marketCap: real('market_cap').notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.symbol, t.date] }),
  dateIdx: index('idx_mcap_date').on(t.date),
}));

// Все рейтинговые действия (grades) из FMP
export const grades = sqliteTable('grades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  date: text('date').notNull(),
  newGrade: text('new_grade'),
  previousGrade: text('previous_grade'),
  gradingCompany: text('grading_company'),
  action: text('action'),
}, t => ({
  symbolIdx: index('idx_grades_symbol').on(t.symbol),
  dateIdx: index('idx_grades_date').on(t.date),
}));

// Точный point-in-time top-N на 31.12 каждого года (computed)
export const topNPerYear = sqliteTable('top_n_per_year', {
  year: integer('year').notNull(),
  rank: integer('rank').notNull(),
  symbol: text('symbol').notNull(),
  marketCap: real('market_cap'),
  snapshotDate: text('snapshot_date'),
}, t => ({
  pk: primaryKey({ columns: [t.year, t.rank] }),
  yearIdx: index('idx_top_year').on(t.year),
}));

// Финальный результат: отфильтрованные апгрейды с year-колонкой
export const ratingChangesFiltered = sqliteTable('rating_changes_filtered', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  year: integer('year').notNull(),
  date: text('date').notNull(),
  symbol: text('symbol').notNull(),
  newRating: text('new_rating'),
  previousRating: text('previous_rating'),
  newGradeRaw: text('new_grade_raw'),
  previousGradeRaw: text('previous_grade_raw'),
  gradingCompany: text('grading_company'),
  action: text('action'),
  jumpSize: integer('jump_size'),
  minJump: integer('min_jump'),
  consensusBefore: real('consensus_before'),
  consensusFirmCount: integer('consensus_firm_count'),
  belowConsensus: integer('below_consensus'),  // 0/1
  computedAt: text('computed_at').notNull(),
}, t => ({
  yearIdx: index('idx_rcf_year').on(t.year),
  symbolIdx: index('idx_rcf_symbol').on(t.symbol),
}));

// Исторический консенсус аналитиков (counts на дату) из FMP grades-historical.
// Используется для точного point-in-time консенсуса при фильтрации.
export const consensusHistory = sqliteTable('consensus_history', {
  symbol: text('symbol').notNull(),
  date: text('date').notNull(),
  strongBuy: integer('strong_buy'),
  buy: integer('buy'),
  hold: integer('hold'),
  sell: integer('sell'),
  strongSell: integer('strong_sell'),
  totalAnalysts: integer('total_analysts'),
  consensusScore: real('consensus_score'),
  raw: text('raw'),
}, t => ({
  pk: primaryKey({ columns: [t.symbol, t.date] }),
  symbolIdx: index('idx_consensus_symbol').on(t.symbol),
  dateIdx: index('idx_consensus_date').on(t.date),
}));

// EPS Surprise: квартальные сюрпризы по прибыли (модуль /eps).
// Источник — FMP /stable/earnings. Накопительно, без overwrite.
export const epsSurprises = sqliteTable('eps_surprises', {
  symbol: text('symbol').notNull(),
  date: text('date').notNull(),                  // дата отчёта (announcement)
  fiscalDateEnding: text('fiscal_date_ending'),  // конец фискального периода, если есть
  epsActual: real('eps_actual'),
  epsEstimated: real('eps_estimated'),
  surprise: real('surprise'),                    // actual - estimated
  surprisePct: real('surprise_pct'),             // surprise / |estimated| * 100
  revenueActual: real('revenue_actual'),
  revenueEstimated: real('revenue_estimated'),
  fetchedAt: text('fetched_at').notNull(),
  raw: text('raw'),
}, t => ({
  pk: primaryKey({ columns: [t.symbol, t.date] }),
  symbolIdx: index('idx_eps_symbol').on(t.symbol),
  dateIdx: index('idx_eps_date').on(t.date),
}));

// === Leverage Monitor (модуль /leverage) ===
// Метаданные временного ряда: один ряд = одна метрика одного источника/сегмента.
// id формата '<source>:<key>', например 'fred:BOGZ1FL663067003Q' или 'cftc:ES:net_pct_oi'.
export const leverageSeries = sqliteTable('leverage_series', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),        // fred | finra | cftc
  segment: text('segment').notNull(),      // us_equities | futures | ...
  label: text('label').notNull(),          // человекочитаемое имя
  unit: text('unit'),                       // USD, % OI, index, ...
  metric: text('metric').notNull(),         // margin_debt | net_pct_oi | ...
  frequency: text('frequency').notNull(),   // daily | weekly | monthly | quarterly
  lagNote: text('lag_note'),                // '~5 недель' и т.п. — для показа лага в UI
  indexSymbol: text('index_symbol'),        // символ FMP для overlay цены (^GSPC, BTCUSD)
  higherIsRisk: integer('higher_is_risk').notNull().default(1), // 1: рост = больше плеча/риска
  meta: text('meta'),                       // произвольный JSON
  updatedAt: text('updated_at'),
}, t => ({
  segmentIdx: index('idx_lev_series_segment').on(t.segment),
  sourceIdx: index('idx_lev_series_source').on(t.source),
}));

// Наблюдения временного ряда. value хранится как есть в единицах ряда.
export const leverageObservations = sqliteTable('leverage_observations', {
  seriesId: text('series_id').notNull(),
  date: text('date').notNull(),            // YYYY-MM-DD
  value: real('value').notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.seriesId, t.date] }),
  dateIdx: index('idx_lev_obs_date').on(t.date),
}));

// Метаданные запусков pipeline
export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),            // running, completed, failed
  startYear: integer('start_year'),
  endYear: integer('end_year'),
  topN: integer('top_n'),
  minJump: integer('min_jump'),
  rowsWritten: integer('rows_written'),
  notes: text('notes'),
});
