import { NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

// SQL миграции встроены прямо в код, чтобы не зависеть от файловой системы
// serverless-функции на Vercel. Источник: drizzle/0000_jittery_scorpion.sql.
// Все CREATE используют IF NOT EXISTS — повторный запуск безопасен.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS grades (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    symbol text NOT NULL,
    date text NOT NULL,
    new_grade text,
    previous_grade text,
    grading_company text,
    action text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_grades_symbol ON grades (symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_grades_date ON grades (date)`,

  `CREATE TABLE IF NOT EXISTS market_cap (
    symbol text NOT NULL,
    date text NOT NULL,
    market_cap real NOT NULL,
    PRIMARY KEY (symbol, date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mcap_date ON market_cap (date)`,

  `CREATE TABLE IF NOT EXISTS rating_changes_filtered (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    year integer NOT NULL,
    date text NOT NULL,
    symbol text NOT NULL,
    new_rating text,
    previous_rating text,
    new_grade_raw text,
    previous_grade_raw text,
    grading_company text,
    action text,
    jump_size integer,
    min_jump integer,
    computed_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rcf_year ON rating_changes_filtered (year)`,
  `CREATE INDEX IF NOT EXISTS idx_rcf_symbol ON rating_changes_filtered (symbol)`,

  `CREATE TABLE IF NOT EXISTS runs (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    started_at text NOT NULL,
    finished_at text,
    status text NOT NULL,
    start_year integer,
    end_year integer,
    top_n integer,
    min_jump integer,
    rows_written integer,
    notes text
  )`,

  `CREATE TABLE IF NOT EXISTS sp500_changes (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    date text NOT NULL,
    added_symbol text,
    removed_symbol text,
    reason text,
    raw text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sp500_changes_date ON sp500_changes (date)`,

  `CREATE TABLE IF NOT EXISTS sp500_current (
    symbol text PRIMARY KEY NOT NULL,
    name text,
    sector text,
    sub_sector text,
    founded text,
    fetched_at text NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS top_n_per_year (
    year integer NOT NULL,
    rank integer NOT NULL,
    symbol text NOT NULL,
    market_cap real,
    snapshot_date text,
    PRIMARY KEY (year, rank)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_top_year ON top_n_per_year (year)`,

  `CREATE TABLE IF NOT EXISTS consensus_history (
    symbol text NOT NULL,
    date text NOT NULL,
    strong_buy integer,
    buy integer,
    hold integer,
    sell integer,
    strong_sell integer,
    total_analysts integer,
    consensus_score real,
    raw text,
    PRIMARY KEY (symbol, date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_consensus_symbol ON consensus_history (symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_consensus_date ON consensus_history (date)`,

  `CREATE TABLE IF NOT EXISTS eps_surprises (
    symbol text NOT NULL,
    date text NOT NULL,
    fiscal_date_ending text,
    eps_actual real,
    eps_estimated real,
    surprise real,
    surprise_pct real,
    revenue_actual real,
    revenue_estimated real,
    fetched_at text NOT NULL,
    raw text,
    PRIMARY KEY (symbol, date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_eps_symbol ON eps_surprises (symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_eps_date ON eps_surprises (date)`,
];

// ALTER-стейтменты: SQLite не имеет ADD COLUMN IF NOT EXISTS, поэтому
// гоним их через try/catch — повторный запуск проигнорирует ошибку
// «duplicate column name» и пойдёт дальше.
const ALTERS = [
  `ALTER TABLE rating_changes_filtered ADD COLUMN consensus_before REAL`,
  `ALTER TABLE rating_changes_filtered ADD COLUMN consensus_firm_count INTEGER`,
  `ALTER TABLE rating_changes_filtered ADD COLUMN below_consensus INTEGER`,
];

export async function POST() {
  const results: Array<{ ok: boolean; sql: string; error?: string }> = [];
  try {
    for (const sql of STATEMENTS) {
      try {
        await libsqlClient.execute(sql);
        results.push({ ok: true, sql: sql.split('\n')[0] });
      } catch (e: any) {
        results.push({ ok: false, sql: sql.split('\n')[0], error: e.message });
      }
    }
    // ALTER-стейтменты: повторный запуск даёт "duplicate column" — это ок
    for (const sql of ALTERS) {
      try {
        await libsqlClient.execute(sql);
        results.push({ ok: true, sql });
      } catch (e: any) {
        const ignorable = /duplicate column/i.test(e.message);
        results.push({ ok: ignorable, sql, error: ignorable ? undefined : e.message });
      }
    }
    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      return NextResponse.json({ ok: false, results, failed: failed.length }, { status: 500 });
    }
    return NextResponse.json({ ok: true, executed: results.length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
