import { libsqlClient } from '@/db/client';
import { aimlChatMeta } from '@/lib/aimlapi';

// Перевод коротких текстов (описание компании, заголовки/сниппеты новостей) на русский через aimlapi,
// с кэшем в libSQL по хэшу исходного текста. Graceful — без ключа/при ошибке отдаём оригинал.
//
// Почему адаптивный батчинг: русский в токенах gpt в ~2-3× «тяжелее» английского. Крупный батч
// с фиксированным max_tokens обрезается (finish_reason='length') → JSON.parse падает → весь батч
// остаётся без перевода. Поэтому: (1) max_tokens считаем от объёма текста, (2) при обрезке/битом
// JSON рекурсивно делим батч пополам вплоть до одного текста, (3) при фатальной ошибке аккаунта
// (нет средств/неверный ключ) прекращаем вызовы — оригиналы отдадутся ниже.
let ensured = false;
async function ensure(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS ticker_translations (
    hash TEXT PRIMARY KEY, ru TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}
function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Фатально для всего прогона: нет смысла продолжать слать запросы (деньги/ключ).
function isFatalAimlError(msg: string): boolean {
  return /run out of funds|out of funds|usage limit|reached your specified|invalid api key|unauthorized|\b401\b/i.test(msg);
}

const SYS_PROMPT =
  'Ты — переводчик финансовых текстов на русский язык. Переведи КАЖДОЕ значение JSON-объекта на естественный ' +
  'русский, сохраняя тикеры, числа, имена компаний и терминологию. Отвечай ТОЛЬКО на русском — не возвращай ' +
  'английский текст как перевод. Верни СТРОГО JSON с теми же ключами и переведёнными значениями, без пояснений.';

type Ctl = { fatal: boolean };
type Sink = { out: Map<string, string>; stmts: { sql: string; args: any[] }[]; now: string };

// Переводит один батч; при обрезке/битом JSON делит пополам (до одного текста). Мутирует sink/ctl.
async function translateBatch(batch: string[], sink: Sink, ctl: Ctl): Promise<void> {
  if (ctl.fatal || !batch.length) return;
  const obj: Record<string, string> = {};
  batch.forEach((t, k) => (obj[String(k)] = t));
  // ~1 токен на ~1.4 символа кириллицы + структура JSON; потолок в пределах лимита модели.
  const chars = batch.reduce((s, t) => s + t.length, 0);
  const maxTok = Math.min(8000, Math.max(1200, Math.ceil(chars * 1.5) + 400));

  let content = '';
  let finish: string | null = null;
  try {
    const r = await aimlChatMeta({
      response_format: { type: 'json_object' },
      max_tokens: maxTok,
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: JSON.stringify(obj) },
      ],
    });
    content = r.content;
    finish = r.finishReason;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? '');
    if (isFatalAimlError(msg)) ctl.fatal = true; // нет средств/ключа — прекращаем весь прогон
    return; // прочие сбои: этот батч оставим без перевода (оригиналы ниже)
  }

  let parsed: any = null;
  if (finish !== 'length') { try { parsed = JSON.parse(content); } catch { parsed = null; } }
  const complete = parsed && typeof parsed === 'object' &&
    batch.every((_, k) => typeof parsed[String(k)] === 'string' && parsed[String(k)].trim());

  if (complete) {
    batch.forEach((t, k) => {
      const ru = String(parsed[String(k)]).trim();
      sink.out.set(t, ru);
      sink.stmts.push({
        sql: `INSERT INTO ticker_translations (hash,ru,created_at) VALUES (?,?,?) ON CONFLICT(hash) DO UPDATE SET ru=excluded.ru`,
        args: [hashStr(t), ru, sink.now],
      });
    });
    return;
  }
  // Обрезка / битый / неполный JSON: делим пополам. Один текст, что не смог — оставляем оригинал.
  if (batch.length === 1) return;
  const mid = Math.ceil(batch.length / 2);
  await translateBatch(batch.slice(0, mid), sink, ctl);
  await translateBatch(batch.slice(mid), sink, ctl);
}

/** Возвращает карту оригинал→русский. Кэш-первым; недостающее переводит батчами и кэширует. */
export async function translateMany(texts: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(texts.map((t) => (t || '').trim()).filter((t) => t.length > 1))];
  if (!uniq.length) return out;
  await ensure();
  const byHash = new Map<string, string>();
  uniq.forEach((t) => byHash.set(hashStr(t), t));
  const hashes = [...byHash.keys()];
  for (let i = 0; i < hashes.length; i += 200) {
    const chunk = hashes.slice(i, i + 200);
    const ph = chunk.map(() => '?').join(',');
    const r = await libsqlClient.execute({ sql: `SELECT hash,ru FROM ticker_translations WHERE hash IN (${ph})`, args: chunk });
    for (const row of r.rows) { const orig = byHash.get(String((row as any).hash)); if (orig) out.set(orig, String((row as any).ru)); }
  }
  const missing = uniq.filter((t) => !out.has(t));
  if (missing.length && process.env.AIMLAPI_KEY) {
    const sink: Sink = { out, stmts: [], now: new Date().toISOString() };
    const ctl: Ctl = { fatal: false };
    // Небольшие стартовые батчи: большинство укладывается в один вызов, при обрезке делятся.
    const START = 10;
    for (let i = 0; i < missing.length && !ctl.fatal; i += START) {
      await translateBatch(missing.slice(i, i + START), sink, ctl);
    }
    if (sink.stmts.length) { try { await libsqlClient.batch(sink.stmts); } catch { /* кэш не критичен */ } }
  }
  for (const t of uniq) if (!out.has(t)) out.set(t, t);
  return out;
}
