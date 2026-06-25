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

// ── даты: парсинг + окно year-ahead ──────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
type YM = { y: number; m: number }; // m=0 — месяц неизвестен
function parseYM(s: any): YM | null {
  if (!s) return null;
  const str = String(s);
  let m = str.match(/(\d{4})[-/.](\d{1,2})/); // 2023-12 / 2023/12
  if (m) return { y: +m[1], m: Math.min(12, Math.max(1, +m[2])) };
  m = str.match(/([A-Za-z]{3,9})\.?\s+(\d{4})/); // December 2023
  if (m && MONTHS[m[1].toLowerCase()]) return { y: +m[2], m: MONTHS[m[1].toLowerCase()] };
  m = str.match(/\b(20\d{2})\b/); // только год
  if (m) return { y: +m[1], m: 0 };
  return null;
}
// Year-ahead окно для года Y: публикация авг.(Y−1) … апр.(Y). Неизвестный месяц —
// принимаем, если год = Y−1 или Y (с пометкой неуверенности на стороне вызова).
function dateOkFor(ym: YM | null, year: number): boolean {
  if (!ym) return false;
  if (ym.m === 0) return ym.y === year - 1 || ym.y === year;
  const a = ym.y * 12 + ym.m;
  return a >= (year - 1) * 12 + 8 && a <= year * 12 + 4;
}

// ── best-effort открытие статьи: дата из JSON-LD / og:meta ───────────────────
async function verifySource(url: string): Promise<{ reachable: boolean; ym: YM | null }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; fmp-ratings/1.0)' } });
    clearTimeout(t);
    if (!res.ok) return { reachable: false, ym: null };
    const html = (await res.text()).slice(0, 200_000);
    const pat = [
      /"datePublished"\s*:\s*"([^"]+)"/i,
      /property=["']article:published_time["']\s+content=["']([^"']+)["']/i,
      /content=["']([^"']+)["']\s+property=["']article:published_time["']/i,
      /name=["'](?:pubdate|publishdate|date)["']\s+content=["']([^"']+)["']/i,
      /<time[^>]+datetime=["']([^"']+)["']/i,
    ];
    for (const re of pat) { const m = html.match(re); if (m) { const ym = parseYM(m[1]); if (ym) return { reachable: true, ym }; } }
    return { reachable: true, ym: null };
  } catch {
    return { reachable: false, ym: null };
  }
}

// Структуризатор: извлечение взглядов + вывод/оценка ожидаемого % (без перевода —
// перевод отдельным быстрым батч-вызовом translateRows, чтобы каждый запрос
// укладывался в serverless-лимит). % считаем где можно, качественное — оценка с флагом.
const STRUCT_SYS =
  'You convert sell-side research notes into STRICT JSON. ' +
  'Output: {"views":[{"bank":"","stance":"overweight|neutral|underweight|bullish|bearish|buy|hold|sell","signal":<int -2..2>,' +
  '"expected_return_pct":<number or null>,"er_basis":"explicit|target_vs_level|qualitative",' +
  '"index_target":<number or null>,"index_level_at_pub":<number or null>,' +
  '"quote":"verbatim quote in the original language","reasoning":"1-2 sentences of key nuances (original language)",' +
  '"source":"outlet/bank","url":"","published_at":"YYYY-MM or YYYY-MM-DD or null"}]}. ' +
  'EXPECTED RETURN (expected_return_pct): ' +
  '(1) if the text states an explicit expected return / % gain for the year, use it with er_basis="explicit". ' +
  '(2) else if it gives an index TARGET for the year AND an index LEVEL around publication, set index_target and index_level_at_pub and compute expected_return_pct = round((target/level - 1)*100, 1), er_basis="target_vs_level". ' +
  '(3) else give a CONSERVATIVE estimate matching the stance (strong bullish/overweight≈+10, bullish/constructive/buy≈+6, "modest gains"≈+3, neutral/flat≈0, cautious/underweight≈-4, bearish/sell≈-10), er_basis="qualitative". ' +
  'signal: +2 strong overweight/very bullish, +1 overweight/constructive/buy, 0 neutral/equal-weight/hold, -1 underweight/cautious, -2 strong underweight/bearish/sell. ' +
  'A view may be an aggregate analyst/Street CONSENSUS (bank="Consensus" or the poll source) or a recognized institution. published_at = the date stated in the text, else null. ' +
  'INCLUDE a view ONLY if it is FORWARD-LOOKING about the asset for the year (an expectation / outlook / target). EXCLUDE: retrospective performance ("recorded/fell/rose X% in a past period", year-in-review); commentary about a different asset (currencies, a single stock, a sub-region) rather than the asset itself; and truncated fragments that are not a complete statement of a view. ' +
  'Only include views actually supported by the text — never invent quotes or explicit numbers (the case-3 estimate is allowed but must match the stated stance). If nothing concrete, return {"views":[]}.';

// Перевод цитат+рассуждений батчем (один дешёвый вызов на ячейку) → RU.
async function translateRows(rows: NewRow[]): Promise<void> {
  const items = rows
    .map((r, i) => ({ i, quote: r.rawQuote || '', reasoning: r.reasoning || '' }))
    .filter((x) => x.quote || x.reasoning);
  if (!items.length) return;
  try {
    const out = await aimlChat({
      model: getAimlModel(),
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1500,
      messages: [
        {
          role: 'system',
          content:
            'Translate financial texts to natural Russian. Input: {"items":[{"i":<int>,"quote":"","reasoning":""}]}. ' +
            'Return STRICT JSON {"items":[{"i":<int>,"quote_ru":"","reasoning_ru":""}]} with the SAME i values. ' +
            'Keep numbers, %, tickers and index names intact. Translate faithfully, do not add or omit content.',
        },
        { role: 'user', content: JSON.stringify({ items }) },
      ],
    });
    const parsed = extractJson(out);
    const arr: any[] = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const t of arr) {
      const idx = Number(t?.i);
      if (Number.isInteger(idx) && rows[idx]) {
        if (t.quote_ru) rows[idx].quoteRu = String(t.quote_ru).slice(0, 400);
        if (t.reasoning_ru) rows[idx].reasoningRu = String(t.reasoning_ru).slice(0, 600);
      }
    }
  } catch {
    /* перевод не критичен — оставляем EN, RU доберём позже */
  }
}

// Ингест на (актив×год), grounded по СТАТЬЯМ:
//  1) Sonar перечисляет реальные статьи year-ahead с датами публикации, цитатами
//     и рассуждением (его сильная сторона — ретрив + источники);
//  2) дешёвая модель структурирует это в строгий JSON;
//  3) дата-гейт: оставляем только статьи в окне year-ahead для года Y; явно
//     не-тот-год отбрасываем; недатированные помечаем dateOk=false;
//  4) best-effort открываем URL и сверяем дату → source_verified.
async function fetchCellFromSonar(code: string, year: number): Promise<{ rows: NewRow[]; dropped: number }> {
  const noun = assetNoun(code);

  // шаг 1 — собрать взгляды. КЛЮЧЕВОЕ-1: ограничиваем веб-поиск Sonar окном
  // публикации year-ahead (сен. Y−1 … фев. Y) — иначе поиск тащит свежак (обзоры
  // текущего года) и путает год. Формат дат Perplexity — MM/DD/YYYY.
  // КЛЮЧЕВОЕ-2 (гипотеза по покрытию): РАЗРЕШАЮЩИЙ промпт — выдавать любой
  // найденный направленный взгляд (банк/брокер/опрос Reuters/институт), даже
  // единичный и без числового таргета; не подавлять в NONE. Это подняло покрытие
  // на выборке с ~13–25% до ~88% при сохранении дат и источников.
  const research = await aimlChatWithCitations({
    model: getAimlSonarModel(),
    extra: {
      search_after_date_filter: `09/01/${year - 1}`,
      search_before_date_filter: `03/01/${year}`,
    },
    messages: [
      {
        role: 'system',
        content:
          'You are a sell-side research analyst with live web access. Rely on high-quality English sources ' +
          '(Bloomberg, Reuters, Financial Times, WSJ, bank research notes, exchanges, recognized institutions). Be specific and factual. Do NOT invent.',
      },
      {
        role: 'user',
        content:
          `Report FORWARD-LOOKING year-ahead views/expectations for ${noun} for CALENDAR YEAR ${year} that appear in the search results — from ` +
          `investment banks, brokers, strategists, analyst polls (Reuters/Bloomberg), or recognized institutions (e.g. World Gold Council for gold). ` +
          `Include DIRECTIONAL or QUALITATIVE views even without a numeric target (e.g. "modest gains expected", "expected to rebound", "bullish", "overweight", "cautious"). ` +
          `For EACH item give: source/author (${BANKS.join(', ')}, brokers, or a poll/consensus); outlet; URL; PUBLICATION DATE (best estimate if not explicit); stance; ` +
          `any ${year} index target or expected return %; a short VERBATIM quote stating the EXPECTATION; and 1–2 sentences of key reasoning/nuances (drivers, risks, caveats). ` +
          `STRICT EXCLUSIONS — do NOT report: (a) RETROSPECTIVE performance ("recorded a gain", "fell 15%", "finished the year up X", monthly/past-period reviews); ` +
          `(b) commentary about a DIFFERENT asset (e.g. currencies, a single stock, a sub-region) rather than ${noun} itself; (c) truncated fragments that are not a complete statement of a view. ` +
          `List EVERY genuine forward-looking item, even one — partial is fine. Answer NONE only if there is genuinely no forward-looking view about ${noun} for ${year}.`,
      },
    ],
    max_tokens: 900,
    temperature: 0.2,
  });
  const prose = research.content?.trim() || '';
  const citations = research.citations;
  if (!prose || /^none\b/i.test(prose)) return { rows: [], dropped: 0 };

  // шаг 2 — структурирование + вывод % + перевод на RU (один вызов)
  let structured = '';
  try {
    structured = await aimlChat({
      model: getAimlModel(),
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: STRUCT_SYS },
        { role: 'user', content: `YEAR=${year}\nASSET=${noun}\n\nSOURCE TEXT:\n${prose.slice(0, 6000)}\n\nReturn the JSON now.` },
      ],
    });
  } catch {
    structured = '';
  }

  const parsed = extractJson(structured);
  const views: any[] = Array.isArray(parsed?.views) ? parsed.views : Array.isArray(parsed) ? parsed : [];
  let dropped = 0;

  // 1) кандидаты + дата-гейт по заявленной дате
  type Cand = { v: any; bank: string; stance: string; er: number | null; erBasis: string; sig: SignalTier; url: string; ym: YM | null; dateOk: boolean };
  const cands: Cand[] = [];
  for (const raw of views.slice(0, 8)) {
    const v = raw || {};
    const bank = String(v.bank || '').trim();
    if (!bank) continue;
    const stance = String(v.stance || '');
    const basisRaw = String(v.er_basis || '').toLowerCase();
    const erBasis = ['explicit', 'target_vs_level', 'qualitative'].includes(basisRaw)
      ? basisRaw : (typeof v.expected_return_pct === 'number' ? 'explicit' : '');
    const er = typeof v.expected_return_pct === 'number' ? v.expected_return_pct / 100 : null;
    const sig = Number.isInteger(v.signal) ? clampTier(v.signal) : stanceToSignal(stance);
    const url = pickUrl(v.url, citations);
    const ym = parseYM(v.published_at);
    const dateOk = dateOkFor(ym, year);
    if (ym && !dateOk) { dropped++; continue; } // явно не тот год → выбрасываем
    cands.push({ v, bank, stance, er, erBasis, sig, url, ym, dateOk });
  }

  // 1b) дедуп по банку в пределах ячейки (один взгляд на банк) — оставляем
  // наиболее информативный: явное число > таргет > оценка; затем ссылка; затем длиннее цитата.
  const candScore = (c: Cand) =>
    (c.erBasis === 'explicit' ? 3 : c.erBasis === 'target_vs_level' ? 2 : 0) +
    (c.url ? 1 : 0) + Math.min(1, String(c.v?.quote || '').length / 200);
  const bankKey = (b: string) => b.toLowerCase().replace(/[^a-zа-я0-9]/gi, '').replace(/(global|research|investment|institute|committee|bank|securities|capital|am|inc)/g, '').slice(0, 18);
  const byBank = new Map<string, Cand>();
  for (const c of cands) {
    const k = bankKey(c.bank) || c.bank.toLowerCase();
    const cur = byBank.get(k);
    if (!cur || candScore(c) > candScore(cur)) byBank.set(k, c);
  }
  const deduped = [...byBank.values()];

  // 2) верификация источников — ПАРАЛЛЕЛЬНО (бюджет 2, под serverless-таймаут)
  const toVerify = deduped.filter((c) => c.url).slice(0, 2);
  const verMap = new Map<string, { reachable: boolean; ym: YM | null }>();
  await Promise.all(toVerify.map(async (c) => { verMap.set(c.url, await verifySource(c.url)); }));

  // 3) финализация строк
  const rows: NewRow[] = [];
  for (const c of deduped) {
    let { ym, dateOk } = c;
    let sourceVerified = false;
    const ver = c.url ? verMap.get(c.url) : undefined;
    if (ver?.reachable) {
      if (ver.ym) {
        if (dateOkFor(ver.ym, year)) { sourceVerified = true; if (!ym) { ym = ver.ym; dateOk = true; } }
        else { dropped++; continue; } // дата страницы противоречит году → выбрасываем
      } else {
        sourceVerified = true; // открылось, но дату не вытащили
      }
    }
    const v = c.v;
    // % из текста (explicit/таргет) — как есть; иначе детерминированная оценка из
    // сигнала, чтобы ЗНАК всегда совпадал со стансом (а не с risk-оговоркой).
    const QUAL_PCT: Record<string, number> = { '2': 0.10, '1': 0.06, '0': 0.01, '-1': -0.04, '-2': -0.10 };
    const hasNum = (c.erBasis === 'explicit' || c.erBasis === 'target_vs_level') && c.er != null;
    const expectedReturn = hasNum ? c.er : (QUAL_PCT[String(c.sig)] ?? null);
    const erBasis = hasNum ? c.erBasis : 'qualitative';
    const erEstimated = !hasNum;
    const confidence = sourceVerified && dateOk ? 0.9 : c.url && dateOk ? 0.7 : c.url ? 0.45 : 0.3;
    rows.push({
      bank: c.bank,
      format: stanceToFormat(c.stance, hasNum),
      signal: c.sig,
      expectedReturn,
      erEstimated,
      erBasis,
      rawQuote: String(v.quote || c.stance || '').slice(0, 400),
      quoteRu: '', // заполнит translateRows ниже
      reasoning: String(v.reasoning || '').slice(0, 600),
      reasoningRu: '',
      sourceName: String(v.source || '').slice(0, 80) || (c.url ? new URL(c.url).hostname.replace(/^www\./, '') : 'web'),
      sourceUrl: c.url,
      asOf: ym ? `${ym.y}-${String(ym.m || 12).padStart(2, '0')}` : `${year - 1}-12`,
      publishedAt: ym ? `${ym.y}-${String(ym.m || 0).padStart(2, '0')}` : '',
      dateOk,
      sourceVerified,
      confidence,
      extractedBy: 'sonar',
    });
  }
  await translateRows(rows); // перевод цитат/рассуждений на RU (один батч-вызов)
  return { rows, dropped };
}

// Синтетический фолбэк без ключа (§6): берём детерминированные прогнозы из мока.
function syntheticCell(code: string, year: number): NewRow[] {
  const cell = cellOf(code, year);
  if (!cell) return [];
  return cell.forecasts.map((f) => ({
    bank: f.bank, format: f.format, signal: f.signal, expectedReturn: f.expectedReturn,
    erEstimated: false, erBasis: f.expectedReturn != null ? 'explicit' : '',
    rawQuote: f.quote, quoteRu: f.quote, reasoning: '', reasoningRu: '',
    sourceName: f.sourceName, sourceUrl: f.sourceUrl, asOf: f.asOf,
    publishedAt: f.asOf, dateOk: true, sourceVerified: false,
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
        let rows: NewRow[], note: string;
        if (mode === 'sonar') {
          const r = await fetchCellFromSonar(t.asset, t.year);
          rows = r.rows;
          note = r.dropped > 0 ? `sonar (отброшено по дате: ${r.dropped})` : 'sonar';
        } else {
          rows = syntheticCell(t.asset, t.year);
          note = 'synthetic';
        }
        await replaceCellForecasts(t.asset, t.year, rows, note);
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
