import { describe, it, expect, beforeEach, vi } from 'vitest';

// Мокаем БД и AI-клиент, чтобы проверить чистую логику батчинга translateMany:
// (1) при обрезке крупного батча (finish='length') он делится вплоть до одного текста и каждый переводится;
// (2) при фатальной ошибке аккаунта (нет средств) прогон прекращается и отдаются оригиналы.

const execute = vi.fn(async (..._a: any[]) => ({ rows: [] as any[] }));
const batch = vi.fn(async (..._a: any[]) => {});
vi.mock('@/db/client', () => ({ libsqlClient: { execute: (...a: any[]) => execute(...a), batch: (...a: any[]) => batch(...a) } }));

const aimlChatMeta = vi.fn();
vi.mock('@/lib/aimlapi', () => ({ aimlChatMeta: (...a: any[]) => aimlChatMeta(...a) }));

import { translateMany } from './translate';

beforeEach(() => {
  execute.mockClear();
  batch.mockClear();
  aimlChatMeta.mockReset();
  process.env.AIMLAPI_KEY = 'test-key';
});

function keysOf(opts: any): string[] {
  const user = opts.messages.find((m: any) => m.role === 'user');
  return Object.keys(JSON.parse(user.content));
}

describe('translateMany', () => {
  it('при обрезке батча делит его до одного текста и переводит каждый', async () => {
    // Батч из >1 текста «обрезается»; одиночный — переводится успешно.
    aimlChatMeta.mockImplementation(async (opts: any) => {
      const ks = keysOf(opts);
      if (ks.length > 1) return { content: '{"0":"обрез', finishReason: 'length' };
      const obj = JSON.parse(opts.messages.find((m: any) => m.role === 'user').content);
      const out: Record<string, string> = {};
      for (const k of Object.keys(obj)) out[k] = 'RU:' + obj[k];
      return { content: JSON.stringify(out), finishReason: 'stop' };
    });

    const src = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const map = await translateMany(src);
    for (const t of src) expect(map.get(t)).toBe('RU:' + t);
    // кэш записан для каждого текста
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('при фатальной ошибке (нет средств) прекращает вызовы и отдаёт оригиналы', async () => {
    aimlChatMeta.mockRejectedValue(new Error("aimlapi 403: You've run out of funds"));
    const src = Array.from({ length: 25 }, (_, i) => 'text-' + i);
    const map = await translateMany(src);
    for (const t of src) expect(map.get(t)).toBe(t); // оригиналы
    // фатальный сбой на первом же вызове останавливает цикл (не 3 батча по 10)
    expect(aimlChatMeta).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
  });

  it('без ключа AIMLAPI не вызывает модель и отдаёт оригиналы', async () => {
    delete process.env.AIMLAPI_KEY;
    const map = await translateMany(['hello', 'world']);
    expect(map.get('hello')).toBe('hello');
    expect(aimlChatMeta).not.toHaveBeenCalled();
  });
});
