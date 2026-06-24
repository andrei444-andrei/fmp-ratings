import { aimlChat, aimlChatWithCitations, getAimlSonarModel, getAimlModel, getAimlApiKey } from '@/lib/aimlapi';
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

// Мусорные/несерьёзные домены — не считаем источником прогноза.
const BAD_HOST = /youtube|youtu\.be|facebook|instagram|tiktok|reddit|twitter|x\.com|pinterest|quora/i;
function pickUrl(viewUrl: any, citations: string[]): string {
  const cands = [viewUrl, ...citations].filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u) && !BAD_HOST.test(u));
  return cands[0] || '';
}

function extractJson(content: string): any | null {
  try { return JSON.parse(content); } catch { /* try to find a json blob */ }
  const m = content.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

// Английские наименования активов для веб-запроса (русские display-имена в
// промпт не пускаем — модель путается на смеси языков).
const EN_NOUN: Record<string, string> = {
  US: 'US equities (S&P 500)',
  DE: 'German equities (DAX)',
  GB: 'UK equities (FTSE 100)',
  JP: 'Japanese equities (Nikkei 225 / TOPIX)',
  CN: 'Chinese equities (MSCI China)',
  IN: 'Indian equities (Nifty 50 / Sensex)',
  BR: 'Brazilian equities (Bovespa)',
  PL: 'Polish equities (WIG)',
  KR: 'Korean equities (KOSPI)',
  EU: 'European equities (STOXX Europe 600)',
  EM: 'emerging-market equities (MSCI Emerging Markets)',
  GLD: 'gold (spot gold price)',
};
function assetNoun(code: string): string {
  return EN_NOUN[code] ?? COUNTRIES.find((c) => c.code === code)?.bench ?? code;
}

// Двухшаговый ингест на (актив×год):
//  1) Sonar тянет ПРОЗУ с источниками (его сильная сторона — выше recall);
//  2) дешёвая модель СТРУКТУРИРУЕТ прозу в строгий JSON (без выдумок).
async function fetchCellFromSonar(code: string, year: number): Promise<NewRow[]> {
  const noun = assetNoun(code);

  // шаг 1 — ретрив прозой
  const research = await aimlChatWithCitations({
    model: getAimlSonarModel(),
    messages: [
      {
        role: 'system',
        content:
          'You are a sell-side research analyst with live web access. Rely on high-quality English sources ' +
          '(Bloomberg, Reuters, Financial Times, WSJ, bank research notes, exchanges). Be specific and factual. Do NOT invent.',
      },
      {
        role: 'user',
        content:
          `Summarize the YEAR-AHEAD house views that major investment banks (${BANKS.join(', ')}, and others) published for ${noun} ` +
          `FOR CALENDAR YEAR ${year} (outlooks released around ${year - 1}Q4–${year}Q1). For each bank you can find: their stance ` +
          `(overweight / neutral / underweight, or buy / hold / sell), any index target or expected return %, a short verbatim quote, ` +
          `and the publication date. Be concrete with bank names and figures. If you cannot find ${year}-specific views, say so plainly. English prose.`,
      },
    ],
    max_tokens: 800,
    temperature: 0.2,
  });
  const prose = research.content?.trim() || '';
  const citations = research.citations;
  if (!prose) return [];

  // шаг 2 — структурирование в JSON
  let structured = '';
  try {
    structured = await aimlChat({
      model: getAimlModel(),
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content:
            'Extract investment-bank market views from the SOURCE TEXT into STRICT JSON: ' +
            '{"views":[{"bank":"","stance":"overweight|neutral|underweight|buy|hold|sell","signal":<int -2..2>,' +
            '"expected_return_pct":<number or null>,"quote":"verbatim if present","source":"outlet/bank","url":"","as_of":"YYYY-MM"}]}. ' +
            'signal scale: +2 strong overweight/top pick, +1 overweight/constructive/buy, 0 neutral/equal-weight/hold, -1 underweight/cautious, -2 strong underweight/avoid/sell. ' +
            'Only include views actually supported by the text — never invent. If a view is not tied to a specific bank, set bank to the source/house name. ' +
            'If the text contains no concrete view, return {"views":[]}.',
        },
        { role: 'user', content: `YEAR=${year}\nASSET=${noun}\n\nSOURCE TEXT:\n${prose.slice(0, 4000)}\n\nReturn the JSON now.` },
      ],
    });
  } catch {
    structured = '';
  }

  const parsed = extractJson(structured);
  const views: any[] = Array.isArray(parsed?.views) ? parsed.views : Array.isArray(parsed) ? parsed : [];
  const rows: NewRow[] = [];
  for (let i = 0; i < views.length; i++) {
    const v = views[i] || {};
    const bank = String(v.bank || '').trim();
    if (!bank) continue;
    const stance = String(v.stance || '');
    const er = typeof v.expected_return_pct === 'number' ? v.expected_return_pct / 100 : null;
    const sig = Number.isInteger(v.signal) ? clampTier(v.signal) : stanceToSignal(stance);
    const url = pickUrl(v.url, citations);
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
