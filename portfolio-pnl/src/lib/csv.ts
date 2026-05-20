import type { AssetClass, ParsedHolding } from './types';

// Минимальный, но устойчивый CSV-парсер: поддерживает кавычки и запятые внутри полей.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',' || c === ';' || c === '\t') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else if (c === '\r') {
      // игнор
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
  }
  return rows;
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  // Убираем валютные символы, пробелы-разделители тысяч, скобки = отрицательное.
  const neg = /^\(.*\)$/.test(v.trim());
  const cleaned = v.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function findCol(header: string[], names: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const idx = lower.findIndex((h) => h === n || h.includes(n));
    if (idx !== -1) return idx;
  }
  return -1;
}

export type CsvMapResult = {
  holdings: ParsedHolding[];
  // Строки, которые не удалось разложить по известным колонкам — кандидаты на AI-парсинг.
  unmapped: string[];
};

// Эвристическое сопоставление колонок типичных брокерских выгрузок
// (IBKR, Schwab, Fidelity, Tinkoff/T-Bank и пр.). Что не легло — в unmapped.
export function mapBrokerCsv(text: string, assetClass: AssetClass): CsvMapResult {
  const rows = parseCsv(text);
  const result: CsvMapResult = { holdings: [], unmapped: [] };
  if (rows.length < 2) {
    if (rows.length) result.unmapped.push(rows[0].join(','));
    return result;
  }
  const header = rows[0];
  const symbolCol = findCol(header, ['symbol', 'ticker', 'тикер']);
  const nameCol = findCol(header, ['description', 'name', 'security', 'instrument', 'наименование', 'актив']);
  const qtyCol = findCol(header, ['quantity', 'qty', 'shares', 'кол-во', 'количество']);
  const valueCol = findCol(header, ['market value', 'value', 'mktval', 'position value', 'стоимость', 'оценка']);
  const costCol = findCol(header, ['cost basis', 'cost', 'avg cost', 'себестоимость']);
  const acctCol = findCol(header, ['account', 'счет', 'счёт']);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawLine = row.join(',');
    const value = num(valueCol !== -1 ? row[valueCol] : undefined);
    const name = (nameCol !== -1 ? row[nameCol] : '')?.trim();
    const symbol = (symbolCol !== -1 ? row[symbolCol] : '')?.trim();
    if (value == null || (!name && !symbol)) {
      result.unmapped.push(rawLine);
      continue;
    }
    result.holdings.push({
      assetClass,
      name: name || symbol,
      symbol: symbol || null,
      quantity: num(qtyCol !== -1 ? row[qtyCol] : undefined),
      value,
      costBasis: num(costCol !== -1 ? row[costCol] : undefined),
      account: (acctCol !== -1 ? row[acctCol] : '')?.trim() || null,
      raw: rawLine,
    });
  }
  return result;
}
