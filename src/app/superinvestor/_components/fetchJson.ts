'use client';

// Безопасный fetch: serverless может вернуть НЕ-JSON (страница таймаута/краша) —
// тогда r.json() падает. Возвращаем transient=true, чтобы клиент продолжил опрос
// (под-фетчи 13F/цен кэшируются инкрементально, повторные запросы сходятся).
export type FetchJson = { data?: any; transient: boolean; status?: number };

export async function safeFetchJson(url: string): Promise<FetchJson> {
  try {
    const r = await fetch(url);
    const text = await r.text();
    try {
      return { data: JSON.parse(text), transient: false, status: r.status };
    } catch {
      return { transient: true, status: r.status }; // не-JSON = серверный таймаут/ошибка
    }
  } catch {
    return { transient: true }; // сетевой сбой
  }
}
