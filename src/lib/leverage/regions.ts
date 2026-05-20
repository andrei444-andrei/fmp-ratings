import type { Obs } from './stats';

// Регионы для метрики Margin Debt / Market Cap.
// id ряда — `mdmc:<CODE>`. США считается автоматически (FINRA + FRED Z.1),
// остальные регионы — импортом CSV (margin debt + market cap → %).
export type RegionDef = { code: string; name: string; color: string };

export const REGIONS: RegionDef[] = [
  { code: 'US', name: 'США', color: '#2563eb' },
  { code: 'KR', name: 'Южная Корея', color: '#dc2626' },
  { code: 'JP', name: 'Япония', color: '#16a34a' },
  { code: 'CN', name: 'Китай', color: '#d97706' },
  { code: 'EU', name: 'Еврозона', color: '#7c3aed' },
];

export function regionName(code: string): string {
  return REGIONS.find(r => r.code === code)?.name ?? code;
}
export function regionColor(code: string): string {
  return REGIONS.find(r => r.code === code)?.color ?? '#6b7280';
}
export function mdmcId(code: string): string {
  return `mdmc:${code.toUpperCase()}`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseNum(s: string): number | null {
  if (s == null) return null;
  const c = s.replace(/[$,%\s]/g, '');
  if (c === '' || c === '-') return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

// Нормализуем дату к YYYY-MM-DD. Поддержка YYYY-MM, YYYY-MM-DD, MM/YYYY, Mon-YY.
const MONTHS: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function parseDate(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+(m[3]||'1')).padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[2]}-${String(+m[1]).padStart(2,'0')}-01`;
  m = s.match(/^([A-Za-z]{3,9})[-\s](\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0,3).toLowerCase()];
    if (mo) { let y = +m[2]; if (y < 100) y += y < 70 ? 2000 : 1900; return `${y}-${String(mo).padStart(2,'0')}-01`; }
  }
  return null;
}

export type RegionParseResult = { obs: Obs[]; mode: 'ratio' | 'margin/cap'; header: string[] };

// Парсит CSV региона. Два формата:
//   1) date, pct                 — готовое отношение (%)
//   2) date, margin_debt, market_cap — считаем margin/cap*100
// Колонки определяются по ключевым словам заголовка.
export function parseRegionCsv(text: string): RegionParseResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) throw new Error('Пустой CSV');

  let headerIdx = lines.findIndex(l => /date|month|year|period|margin|cap|ratio|pct|%/i.test(l));
  if (headerIdx < 0) headerIdx = 0;
  const header = splitCsvLine(lines[headerIdx]);
  const lower = header.map(h => h.toLowerCase());

  const dateCol = (() => { const i = lower.findIndex(h => /date|month|year|period/.test(h)); return i >= 0 ? i : 0; })();
  const capCol = lower.findIndex(h => /market[ _]*cap|mkt[ _]*cap|mktcap|capitali|market[ _]*value|mcap/.test(h));
  // margin ищем ПОСЛЕ cap, чтобы «market_cap» не перехватился как margin-колонка
  const marginCol = lower.findIndex((h, i) => i !== capCol && /margin|debit|debt|loan|balance/.test(h));
  const pctCol = lower.findIndex(h => /ratio|pct|percent|%/.test(h));

  const obs: Obs[] = [];
  const haveMarginCap = marginCol >= 0 && capCol >= 0 && marginCol !== capCol;
  const mode: 'ratio' | 'margin/cap' = haveMarginCap ? 'margin/cap' : 'ratio';

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const date = parseDate(cells[dateCol] ?? '');
    if (!date) continue;
    if (haveMarginCap) {
      const md = parseNum(cells[marginCol]);
      const mc = parseNum(cells[capCol]);
      if (md != null && mc != null && mc > 0) obs.push({ date, value: md / mc * 100 });
    } else {
      const col = pctCol >= 0 ? pctCol : (lower.length > 1 ? 1 : 0);
      const v = parseNum(cells[col]);
      if (v != null) obs.push({ date, value: v });
    }
  }
  if (!obs.length) throw new Error('Не удалось распознать ни строки. Нужны колонки date + (margin_debt & market_cap) или date + pct.');
  obs.sort((a, b) => a.date.localeCompare(b.date));
  return { obs, mode, header };
}
