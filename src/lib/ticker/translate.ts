import { libsqlClient } from '@/db/client';
import { aimlChat } from '@/lib/aimlapi';

// Перевод коротких текстов (описание компании, заголовки/сниппеты новостей) на русский через aimlapi,
// с кэшем в libSQL по хэшу исходного текста. Батчами; graceful — без ключа/при ошибке отдаём оригинал.
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
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      try {
        const obj: Record<string, string> = {};
        batch.forEach((t, k) => (obj[String(k)] = t));
        const content = await aimlChat({
          response_format: { type: 'json_object' },
          max_tokens: 2500,
          messages: [
            { role: 'system', content: 'Ты — переводчик финансовых текстов на русский язык. Переведи каждое значение JSON-объекта на естественный русский, сохраняя тикеры, числа, имена компаний и терминологию. Верни СТРОГО JSON с теми же ключами и переведёнными значениями, без пояснений.' },
            { role: 'user', content: JSON.stringify(obj) },
          ],
        });
        const parsed = JSON.parse(content);
        const now = new Date().toISOString();
        const stmts: { sql: string; args: any[] }[] = [];
        batch.forEach((t, k) => {
          const ru = parsed?.[String(k)];
          if (typeof ru === 'string' && ru.trim()) {
            out.set(t, ru.trim());
            stmts.push({ sql: `INSERT INTO ticker_translations (hash,ru,created_at) VALUES (?,?,?) ON CONFLICT(hash) DO UPDATE SET ru=excluded.ru`, args: [hashStr(t), ru.trim(), now] });
          }
        });
        if (stmts.length) await libsqlClient.batch(stmts);
      } catch { /* graceful: оставим оригинал ниже */ }
    }
  }
  for (const t of uniq) if (!out.has(t)) out.set(t, t);
  return out;
}
