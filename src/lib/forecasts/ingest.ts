import { aimlChatWithCitations, getAimlSonarModel, getAimlApiKey } from '@/lib/aimlapi';
import { logAppError } from '@/lib/app-errors';
import { COUNTRIES, cellOf, type SignalTier } from '@/app/forecasts/mock';
import { replaceCellForecasts, fetchedCells, type ForecastFormat, type ForecastRow } from './store';

// Добыча реальных прогнозов инвестбанков: ОТДЕЛЬНЫЙ англоязычный веб-запрос на
// каждую (актив × год) через Perplexity Sonar (aimlapi, §3) → текст + источники.
// Кэш-первым (§6): покрытые ячейки пропускаем; graceful без ключа → синтетика.

const BANKS = ['Goldman Sachs', 'Morgan Stanley', 'JPMorgan', 'UBS', 'BofA'];

type NewRow = Omit<ForecastRow, 'id' | 'createdAt' | 'asset' | 'year' | 'verified'>;

const clampTier = (n: number): SignalTier => (Math.max(-2, Math.min(2, Math.round(n))) as SignalTier);

// Текстовая позиция → знак сигнала (если модель не дала число).
function stanceToSignal(stance: string): SignalTier {
  const s = stance.toLowerCase();
  if (/strong overweight|top pick|highest conviction|strong buy/.test(s)) return 2;
  if (/overweight|buy|constructive|bullish|favou?r/.test(s)) return 1;
  if (/underweight|sell|avoid|bearish|cautious|reduce/.test(s)) return /strong|least preferred|avoid/.test(s) ? -2 : -1;
  return 0; // neutral / equal-weight / hold / market-weight
}

function stanceToFormat(stance: string, hasNum: boolean): ForecastFormat {
  const s = stance.toLowerCase();
  if (hasNum) return /target/.test(s) ? 'target' : 'ret';
  if (/overweight|underweight|equal.?weight|market.?weight/.test(s)) return 'owuw';
  if (/buy|hold|sell|outperform|underperform/.test(s)) return 'buyhold';
  return 'qual';
}

function extractJson(content: string): any | null {
  try { return JSON.parse(content); } catch { /* try to find a json blob */ }
  const m = content.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

function assetNoun(code: string): string {
  const a = COUNTRIES.find((c) => c.code === code);
  if (!a) return code;
  if (a.cls === 'commodity') return `${a.name === 'Золото' ? 'gold' : a.name} (${a.bench})`;
  if (a.cls === 'region') return `${a.name} equities (${a.bench})`;
  return `${a.name} equities (${a.bench})`;
}

// Один запрос на (актив×год) к Sonar → массив строк прогнозов.
async function fetchCellFromSonar(code: string, year: number): Promise<NewRow[]> {
  const noun = assetNoun(code);
  const sys = {
    role: 'system' as const,
    content:
      'You are a financial research assistant with live web access. Rely on high-quality English sources ' +
      '(Bloomberg, Reuters, Financial Times, WSJ, bank research notes, exchanges). Do NOT invent. ' +
      'Return STRICT JSON only, no prose.',
  };
  const user = {
    role: 'user' as const,
    content:
      `What were major investment banks' (${BANKS.join(', ')}) published house views / outlooks for ${noun} ` +
      `FOR CALENDAR YEAR ${year} specifically — i.e. the year-ahead outlook published around the turn of ${year - 1}/${year} ` +
      `(roughly Nov ${year - 1} – Feb ${year}). Ignore outlooks for any other year. ` +
      `Return STRICT JSON: {"views":[{"bank":"","stance":"overweight|neutral|underweight|buy|hold|sell|...","signal":<int -2..2>,` +
      `"expected_return_pct":<number or null>,"quote":"verbatim phrasing","source":"outlet","url":"https://...","as_of":"YYYY-MM"}]}. ` +
      `signal scale: +2 strong overweight/top pick, +1 overweight/constructive, 0 neutral/equal-weight, -1 underweight/cautious, -2 strong underweight/avoid. ` +
      `Each quote must be about ${year}. Include only banks for which you find a real ${year} view; if none, return {"views":[]}.`,
  };

  const { content, citations } = await aimlChatWithCitations({
    model: getAimlSonarModel(),
    messages: [sys, user],
    max_tokens: 900,
    temperature: 0.1,
  });

  const parsed = extractJson(content);
  const views: any[] = Array.isArray(parsed?.views) ? parsed.views : Array.isArray(parsed) ? parsed : [];
  const rows: NewRow[] = [];
  for (let i = 0; i < views.length; i++) {
    const v = views[i] || {};
    const bank = String(v.bank || '').trim();
    if (!bank) continue;
    const stance = String(v.stance || '');
    const er = typeof v.expected_return_pct === 'number' ? v.expected_return_pct / 100 : null;
    const sig = Number.isInteger(v.signal) ? clampTier(v.signal) : stanceToSignal(stance);
    const url = typeof v.url === 'string' && /^https?:\/\//.test(v.url) ? v.url : (citations[i] || citations[0] || '');
    rows.push({
      bank,
      format: stanceToFormat(stance, er != null),
      signal: sig,
      expectedReturn: er,
      rawQuote: String(v.quote || stance || '').slice(0, 400),
      sourceName: String(v.source || '').slice(0, 80) || (url ? new URL(url).hostname.replace(/^www\./, '') : 'web'),
      sourceUrl: url,
      asOf: String(v.as_of || `${year - 1}-12`).slice(0, 10),
      confidence: url ? 0.7 : 0.4, // без ссылки доверяем меньше
      extractedBy: 'sonar',
    });
  }
  return rows;
}

// Синтетический фолбэк без ключа (§6): берём детерминированные прогнозы из мока.
function syntheticCell(code: string, year: number): NewRow[] {
  const cell = cellOf(code, year);
  if (!cell) return [];
  return cell.forecasts.map((f) => ({
    bank: f.bank, format: f.format, signal: f.signal, expectedReturn: f.expectedReturn,
    rawQuote: f.quote, sourceName: f.sourceName, sourceUrl: f.sourceUrl, asOf: f.asOf,
    confidence: 0.3, extractedBy: 'synthetic' as const,
  }));
}

function hasKey(): boolean {
  try { getAimlApiKey(); return true; } catch { return false; }
}

export type IngestTarget = { asset: string; year: number };
export type IngestResult = { processed: number; found: number; remaining: number; mode: 'sonar' | 'synthetic'; errors: number };

// Добрать прогнозы для непокрытых (или указанных) ячеек. limit ограничивает
// число ячеек за один вызов (под serverless-таймаут). Возвращает остаток.
export async function ingestForecasts(opts: {
  targets?: IngestTarget[];
  years: number[];
  force?: boolean;
  limit?: number;
}): Promise<IngestResult> {
  const mode: 'sonar' | 'synthetic' = hasKey() ? 'sonar' : 'synthetic';
  const limit = opts.limit ?? 4;

  // полный список целей
  const all: IngestTarget[] = opts.targets?.length
    ? opts.targets
    : COUNTRIES.flatMap((c) => opts.years.map((y) => ({ asset: c.code, year: y })));

  // пропускаем уже найденные (если не force)
  const done = opts.force ? new Set<string>() : await fetchedCells();
  const pending = all.filter((t) => !done.has(`${t.asset}:${t.year}`));
  const batch = pending.slice(0, limit);

  let found = 0, errors = 0;
  // ограниченная конкурентность (2) — баланс скорости и rate-limit
  for (let i = 0; i < batch.length; i += 2) {
    const chunk = batch.slice(i, i + 2);
    await Promise.all(chunk.map(async (t) => {
      try {
        const rows = mode === 'sonar' ? await fetchCellFromSonar(t.asset, t.year) : syntheticCell(t.asset, t.year);
        await replaceCellForecasts(t.asset, t.year, rows, mode);
        found += rows.length;
      } catch (e: any) {
        errors++;
        await logAppError({ route: '/api/forecasts/ingest', message: `cell ${t.asset}:${t.year}: ${e?.message || e}`, stack: e?.stack ?? null }).catch(() => {});
        // на ошибке всё равно помечаем попытку синтетикой, чтобы не зациклиться
        try { await replaceCellForecasts(t.asset, t.year, syntheticCell(t.asset, t.year), 'error-fallback'); } catch { /* ignore */ }
      }
    }));
  }

  return { processed: batch.length, found, remaining: Math.max(0, pending.length - batch.length), mode, errors };
}
