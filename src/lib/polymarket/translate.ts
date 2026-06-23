// Перевод вопросов рынков Polymarket на русский через aimlapi (§3 конституции),
// с кэшем в Turso. Graceful: нет ключа / ошибка / нет БД → возвращаем оригинал.

import { libsqlClient } from '@/db/client';
import { aimlChat } from '@/lib/aimlapi';

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS pm_translations (
    en TEXT PRIMARY KEY,
    ru TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

async function cacheGet(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  try {
    await ensureSchema();
    // батчами по 200 во избежание слишком длинного IN(...)
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200);
      const placeholders = chunk.map(() => '?').join(',');
      const r = await libsqlClient.execute({
        sql: `SELECT en, ru FROM pm_translations WHERE en IN (${placeholders})`,
        args: chunk,
      });
      for (const row of r.rows as any[]) out.set(String(row.en), String(row.ru));
    }
  } catch {
    /* кэш недоступен — не критично */
  }
  return out;
}

async function cacheSet(pairs: { en: string; ru: string }[]): Promise<void> {
  if (!pairs.length) return;
  try {
    await ensureSchema();
    // один сетевой раунд-трип вместо N — критично для холодного старта на serverless
    await libsqlClient.batch(
      pairs.map(({ en, ru }) => ({
        sql: `INSERT INTO pm_translations (en, ru) VALUES (?, ?)
              ON CONFLICT(en) DO UPDATE SET ru = excluded.ru`,
        args: [en, ru],
      })),
      'write',
    );
  } catch {
    /* запись недоступна — не критично */
  }
}

async function translateBatch(items: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!items.length || !process.env.AIMLAPI_KEY) return out;
  // карта индекс→текст, чтобы модель отвечала компактным JSON по ключам
  const obj: Record<string, string> = {};
  items.forEach((q, i) => (obj[String(i)] = q));
  try {
    const content = await aimlChat({
      messages: [
        {
          role: 'system',
          content:
            'Ты переводишь вопросы рынков предсказаний (Polymarket) на естественный русский. ' +
            'Сохраняй тикеры, названия компаний, числа, суммы в $ и даты как есть. ' +
            'Верни ТОЛЬКО JSON-объект, сопоставляющий те же ключи переводу. Без пояснений.',
        },
        { role: 'user', content: JSON.stringify(obj) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      temperature: 0.1,
    });
    const parsed = JSON.parse(content) as Record<string, string>;
    for (const [k, v] of Object.entries(parsed)) {
      const idx = Number(k);
      if (Number.isInteger(idx) && items[idx] && typeof v === 'string' && v.trim()) {
        out.set(items[idx], v.trim());
      }
    }
  } catch {
    /* перевод недоступен — отдадим оригиналы */
  }
  return out;
}

// Возвращает map: оригинал(en) → перевод(ru). Для непереведённых ключ отсутствует
// (вызывающий код подставляет оригинал). С бюджетом времени: на холодном старте
// (пустой кэш) перевод может не успеть весь — остаток переведётся при следующих
// обновлениях (непереведённые остаются cache-miss). Каждая пачка пишется в кэш
// сразу, чтобы прогресс не терялся при таймауте serverless-функции.
export async function translateQuestions(
  questions: string[],
  deadlineMs = Date.now() + 25000,
): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(questions.filter((q) => q && q.trim())));
  const result = await cacheGet(uniq);
  const missing = uniq.filter((q) => !result.has(q));

  for (let i = 0; i < missing.length; i += 25) {
    if (Date.now() > deadlineMs) break; // бюджет исчерпан — остальное в следующий раз
    const chunk = missing.slice(i, i + 25);
    const m = await translateBatch(chunk);
    if (!m.size) break; // нет ключа / ошибка — дальше не пытаемся
    const fresh: { en: string; ru: string }[] = [];
    for (const [en, ru] of m) {
      result.set(en, ru);
      fresh.push({ en, ru });
    }
    await cacheSet(fresh); // инкрементальная фиксация прогресса
  }
  return result;
}
