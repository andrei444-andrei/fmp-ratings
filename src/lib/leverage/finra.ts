import * as XLSX from 'xlsx';
import type { Obs } from './stats';

// Парсер CSV статистики FINRA Margin Statistics.
// Источник нестабилен для автозагрузки, поэтому основной путь — ручной импорт CSV
// (вставка/загрузка). Парсер устойчив к разным заголовкам и форматам дат.

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseNum(s: string): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Возвращает первое число месяца в формате YYYY-MM-DD или null.
function parseMonth(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // 2024-01 / 2024-01-31 / 2024/01
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-01`;
  // 01/2024 или 1-2024
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[2]}-${String(+m[1]).padStart(2, '0')}-01`;
  // Jan-24 / Jan-2024 / January 2024 / Jan 2024
  m = s.match(/^([A-Za-z]{3,9})[-\s](\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) {
      let yr = +m[2];
      if (yr < 100) yr += yr < 70 ? 2000 : 1900;
      return `${yr}-${String(mon).padStart(2, '0')}-01`;
    }
  }
  return null;
}

export type FinraParseResult = {
  margin_debt: Obs[];
  free_credit: Obs[];
  rowsParsed: number;
  headerUsed: string[];
};

// Парсит CSV-текст FINRA. Ищет колонку даты и колонки margin debt / free credit
// по ключевым словам заголовка.
export function parseFinraCsv(text: string): FinraParseResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) throw new Error('Пустой CSV');

  // Находим строку заголовка. Ищем строку колонок, а не заголовок-титул:
  // у настоящего заголовка есть «debit»/«free credit»/«balance». «Margin» одиночно
  // не годится — оно встречается в титуле вроде «FINRA Margin Statistics».
  let headerIdx = lines.findIndex(l => /debit|free credit|balance/i.test(l));
  if (headerIdx < 0) headerIdx = lines.findIndex(l => /margin debt/i.test(l));
  if (headerIdx < 0) headerIdx = 0;
  const header = splitCsvLine(lines[headerIdx]);

  const lower = header.map(h => h.toLowerCase());
  const dateCol = lower.findIndex(h => /month|date|year|period/.test(h));
  const debitCol = lower.findIndex(h => /debit|margin debt|margin/.test(h));
  // free credit: предпочитаем «free credit ... cash accounts», иначе любая «free credit»
  let creditCol = lower.findIndex(h => /free credit.*cash/.test(h));
  if (creditCol < 0) creditCol = lower.findIndex(h => /free credit|credit/.test(h));

  const dCol = dateCol >= 0 ? dateCol : 0;
  const margin: Obs[] = [];
  const free: Obs[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const date = parseMonth(cells[dCol] ?? '');
    if (!date) continue;
    if (debitCol >= 0) {
      const v = parseNum(cells[debitCol]);
      if (v != null) margin.push({ date, value: v });
    }
    if (creditCol >= 0 && creditCol !== debitCol) {
      const v = parseNum(cells[creditCol]);
      if (v != null) free.push({ date, value: v });
    }
  }

  return {
    margin_debt: margin,
    free_credit: free,
    rowsParsed: margin.length + free.length,
    headerUsed: header,
  };
}

// --- Автоматическая загрузка с сервера FINRA ---
// FINRA публикует данные Excel-файлом (.xlsx) по версионируемому пути, поэтому
// мы сначала находим ссылку на файл на странице margin-statistics, затем качаем его.
// Путь можно переопределить через FINRA_DATA_URL (если знаете прямой URL .xlsx/.csv).
const FINRA_PAGE_URL = 'https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics';

async function resolveFinraDataUrl(): Promise<string> {
  const override = process.env.FINRA_DATA_URL;
  if (override) return override;

  const res = await fetch(FINRA_PAGE_URL, {
    cache: 'no-store',
    headers: { 'user-agent': 'Mozilla/5.0 (leverage-monitor)' },
  });
  if (!res.ok) throw new Error(`FINRA page ${res.status}`);
  const html = await res.text();
  // ищем ссылку на .xlsx (или .csv) с упоминанием margin
  const m =
    html.match(/href="([^"]*margin[^"]*\.(?:xlsx|csv))"/i) ||
    html.match(/href="([^"]*\.(?:xlsx|csv))"/i);
  if (!m) throw new Error('Не нашёл ссылку на файл данных на странице FINRA; задайте FINRA_DATA_URL');
  return new URL(m[1], FINRA_PAGE_URL).href;
}

// Скачивает и парсит файл FINRA (xlsx или csv) и возвращает тот же результат,
// что и parseFinraCsv.
export async function fetchFinraAuto(): Promise<FinraParseResult & { sourceUrl: string }> {
  const url = await resolveFinraDataUrl();
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': 'Mozilla/5.0 (leverage-monitor)' },
  });
  if (!res.ok) throw new Error(`FINRA file ${res.status}: ${url}`);

  let csvText: string;
  if (/\.csv(\?|$)/i.test(url)) {
    csvText = await res.text();
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('FINRA xlsx: пустой файл');
    csvText = XLSX.utils.sheet_to_csv(sheet);
  }

  const parsed = parseFinraCsv(csvText);
  return { ...parsed, sourceUrl: url };
}
