import { libsqlClient } from '@/db/client';

// Кэш прогнозов инвестбанков для раздела /forecasts.
// Self-provisioning (§1): таблицы создаются лениво, created_at обязателен.
// Кэш-первым (§6): один раз нашли прогноз по (актив×год) — больше веб-поиск не
// гоняем; добор только пустых/устаревших ячеек. forecast_fetch_log отличает
// «искали, ничего не нашли» от «ещё не искали».

export type ForecastFormat = 'ret' | 'target' | 'owuw' | 'buyhold' | 'qual';
export type SignalTier = -2 | -1 | 0 | 1 | 2;

export type ForecastRow = {
  id: number;
  asset: string;
  year: number;
  bank: string;
  format: ForecastFormat;
  signal: SignalTier;
  expectedReturn: number | null;
  erEstimated: boolean;     // % — оценка (не явно указанное число)
  erBasis: string;          // как получен %: explicit | target_vs_level | qualitative | ''
  rawQuote: string;
  quoteRu: string;          // перевод цитаты на русский
  reasoning: string;        // нюансы/рассуждение из самого анонса (оригинал)
  reasoningRu: string;      // перевод рассуждения на русский
  sourceName: string;
  sourceUrl: string;
  asOf: string;
  publishedAt: string;      // дата публикации статьи (YYYY-MM[-DD])
  dateOk: boolean;          // дата в окне year-ahead для целевого года
  sourceVerified: boolean;  // URL открыт и дата подтверждена машинно
  confidence: number;
  extractedBy: 'sonar' | 'manual' | 'synthetic';
  verified: boolean;        // подтверждено человеком
  createdAt: string;
};

export type FetchLogRow = { asset: string; year: number; fetchedAt: string; found: number; note: string | null };

let ensured = false;
export async function ensureForecastTables(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS forecast_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset TEXT NOT NULL,
    year INTEGER NOT NULL,
    bank TEXT NOT NULL,
    format TEXT NOT NULL,
    signal INTEGER NOT NULL,
    expected_return REAL,
    er_estimated INTEGER NOT NULL DEFAULT 0,
    er_basis TEXT,
    raw_quote TEXT,
    quote_ru TEXT,
    reasoning TEXT,
    reasoning_ru TEXT,
    source_name TEXT,
    source_url TEXT,
    as_of TEXT,
    published_at TEXT,
    date_ok INTEGER NOT NULL DEFAULT 1,
    source_verified INTEGER NOT NULL DEFAULT 0,
    confidence REAL,
    extracted_by TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await libsqlClient.execute(`CREATE INDEX IF NOT EXISTS idx_fc_signals_cell ON forecast_signals (asset, year)`);
  // Идемпотентные миграции для БД, созданных раньше (дубль колонки тихо игнорируем).
  for (const col of ['reasoning TEXT', 'published_at TEXT', 'date_ok INTEGER NOT NULL DEFAULT 1', 'source_verified INTEGER NOT NULL DEFAULT 0',
    'er_estimated INTEGER NOT NULL DEFAULT 0', 'er_basis TEXT', 'quote_ru TEXT', 'reasoning_ru TEXT']) {
    try { await libsqlClient.execute(`ALTER TABLE forecast_signals ADD COLUMN ${col}`); } catch { /* колонка уже есть */ }
  }
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS forecast_fetch_log (
    asset TEXT NOT NULL,
    year INTEGER NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    found INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    PRIMARY KEY (asset, year)
  )`);
  ensured = true;
}

function rowToForecast(x: any): ForecastRow {
  return {
    id: Number(x.id),
    asset: String(x.asset),
    year: Number(x.year),
    bank: String(x.bank),
    format: String(x.format) as ForecastFormat,
    signal: Number(x.signal) as SignalTier,
    expectedReturn: x.expected_return != null ? Number(x.expected_return) : null,
    erEstimated: !!Number(x.er_estimated),
    erBasis: x.er_basis != null ? String(x.er_basis) : '',
    rawQuote: x.raw_quote != null ? String(x.raw_quote) : '',
    quoteRu: x.quote_ru != null ? String(x.quote_ru) : '',
    reasoning: x.reasoning != null ? String(x.reasoning) : '',
    reasoningRu: x.reasoning_ru != null ? String(x.reasoning_ru) : '',
    sourceName: x.source_name != null ? String(x.source_name) : '',
    sourceUrl: x.source_url != null ? String(x.source_url) : '',
    asOf: x.as_of != null ? String(x.as_of) : '',
    publishedAt: x.published_at != null ? String(x.published_at) : '',
    dateOk: x.date_ok != null ? !!Number(x.date_ok) : true,
    sourceVerified: !!Number(x.source_verified),
    confidence: x.confidence != null ? Number(x.confidence) : 0,
    extractedBy: String(x.extracted_by) as ForecastRow['extractedBy'],
    verified: !!Number(x.verified),
    createdAt: String(x.created_at),
  };
}

// Все прогнозы (для построения матрицы на клиенте).
export async function listForecasts(): Promise<ForecastRow[]> {
  await ensureForecastTables();
  const r = await libsqlClient.execute(
    `SELECT * FROM forecast_signals ORDER BY asset, year, signal DESC`,
  );
  return r.rows.map(rowToForecast);
}

// Лог запросов: какие ячейки уже искали (и сколько нашли).
export async function listFetchLog(): Promise<FetchLogRow[]> {
  await ensureForecastTables();
  const r = await libsqlClient.execute(`SELECT asset, year, fetched_at, found, note FROM forecast_fetch_log`);
  return r.rows.map((x) => ({
    asset: String(x.asset), year: Number(x.year),
    fetchedAt: String(x.fetched_at), found: Number(x.found),
    note: x.note != null ? String(x.note) : null,
  }));
}

// Какие (актив×год) уже искали — чтобы не гонять повторно.
export async function fetchedCells(): Promise<Set<string>> {
  const log = await listFetchLog();
  return new Set(log.map((l) => `${l.asset}:${l.year}`));
}

// Заменить AI-прогнозы по ячейке (ручные/проверенные — не трогаем) и записать лог.
export async function replaceCellForecasts(
  asset: string,
  year: number,
  rows: Omit<ForecastRow, 'id' | 'createdAt' | 'asset' | 'year' | 'verified'>[],
  note: string | null = null,
): Promise<void> {
  await ensureForecastTables();
  const now = new Date().toISOString();
  const stmts: { sql: string; args: any[] }[] = [
    // сносим только несверённые sonar/synthetic строки этой ячейки
    { sql: `DELETE FROM forecast_signals WHERE asset = ? AND year = ? AND verified = 0 AND extracted_by IN ('sonar','synthetic')`, args: [asset, year] },
  ];
  for (const r of rows) {
    stmts.push({
      sql: `INSERT INTO forecast_signals (asset, year, bank, format, signal, expected_return, er_estimated, er_basis, raw_quote, quote_ru, reasoning, reasoning_ru, source_name, source_url, as_of, published_at, date_ok, source_verified, confidence, extracted_by, verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      args: [asset, year, r.bank, r.format, r.signal, r.expectedReturn, r.erEstimated ? 1 : 0, r.erBasis, r.rawQuote, r.quoteRu, r.reasoning, r.reasoningRu, r.sourceName, r.sourceUrl, r.asOf, r.publishedAt, r.dateOk ? 1 : 0, r.sourceVerified ? 1 : 0, r.confidence, r.extractedBy, now],
    });
  }
  stmts.push({
    sql: `INSERT INTO forecast_fetch_log (asset, year, fetched_at, found, note) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(asset, year) DO UPDATE SET fetched_at = excluded.fetched_at, found = excluded.found, note = excluded.note`,
    args: [asset, year, now, rows.length, note],
  });
  await libsqlClient.batch(stmts);
}

// Ручное переопределение/правка одной строки (отмечается verified=1).
export async function overrideForecast(id: number, patch: Partial<Pick<ForecastRow, 'signal' | 'rawQuote' | 'sourceUrl' | 'expectedReturn'>>): Promise<void> {
  await ensureForecastTables();
  const sets: string[] = [], args: any[] = [];
  if (patch.signal !== undefined) { sets.push('signal = ?'); args.push(patch.signal); }
  if (patch.rawQuote !== undefined) { sets.push('raw_quote = ?'); args.push(patch.rawQuote); }
  if (patch.sourceUrl !== undefined) { sets.push('source_url = ?'); args.push(patch.sourceUrl); }
  if (patch.expectedReturn !== undefined) { sets.push('expected_return = ?'); args.push(patch.expectedReturn); }
  sets.push('verified = 1', "extracted_by = 'manual'");
  if (!sets.length) return;
  args.push(id);
  await libsqlClient.execute({ sql: `UPDATE forecast_signals SET ${sets.join(', ')} WHERE id = ?`, args });
}

export async function deleteForecast(id: number): Promise<void> {
  await ensureForecastTables();
  await libsqlClient.execute({ sql: `DELETE FROM forecast_signals WHERE id = ?`, args: [id] });
}

// Сброс кэша (отладка): стереть прогнозы и лог запросов, чтобы AI пересобрал
// заново. scope='ai' (по умолч.) — только несверённые AI/синтетика; scope='all'
// — всё (включая ручные). Можно ограничить asset/year.
export async function resetForecasts(opts: { scope?: 'ai' | 'all'; asset?: string; year?: number } = {}): Promise<{ deleted: number }> {
  await ensureForecastTables();
  const where: string[] = [], args: any[] = [];
  if (opts.asset) { where.push('asset = ?'); args.push(opts.asset); }
  if (Number.isInteger(opts.year)) { where.push('year = ?'); args.push(opts.year); }
  if (opts.scope !== 'all') where.push("verified = 0 AND extracted_by IN ('sonar','synthetic')");
  const del = await libsqlClient.execute({
    sql: `DELETE FROM forecast_signals${where.length ? ' WHERE ' + where.join(' AND ') : ''}`,
    args,
  });
  // лог запросов чистим по тем же asset/year (чтобы ячейки снова считались «не искали»)
  const lw: string[] = [], la: any[] = [];
  if (opts.asset) { lw.push('asset = ?'); la.push(opts.asset); }
  if (Number.isInteger(opts.year)) { lw.push('year = ?'); la.push(opts.year); }
  await libsqlClient.execute({ sql: `DELETE FROM forecast_fetch_log${lw.length ? ' WHERE ' + lw.join(' AND ') : ''}`, args: la });
  return { deleted: Number(del.rowsAffected ?? 0) };
}
