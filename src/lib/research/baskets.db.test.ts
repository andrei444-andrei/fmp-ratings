// Интеграционный тест слоя корзин против локального libSQL-файла.
process.env.LOCAL_SQLITE_PATH = `/tmp/baskets-it-${process.pid}.db`;

import { describe, it, expect, beforeAll } from 'vitest';
import { listBaskets, upsertBasket, deleteBasket } from './baskets';
import { libsqlClient } from '@/db/client';

beforeAll(async () => {
  await libsqlClient.execute('DROP TABLE IF EXISTS research_baskets');
});

describe('research_baskets (libSQL)', () => {
  it('upsert/list/обновление/нормализация тикеров', async () => {
    await upsertBasket({ id: 'a', name: 'Полупроводники', tickers: ['smh', 'soxx', 'NVDA', 'nvda'] });
    await upsertBasket({ id: 'b', name: 'Металлы', tickers: ['GLD', 'SLV'] });
    let all = await listBaskets();
    expect(all.map((x) => x.id)).toEqual(['a', 'b']);
    expect(all.find((x) => x.id === 'a')!.tickers).toEqual(['SMH', 'SOXX', 'NVDA']); // верхний регистр + дедуп
    // обновление того же id
    await upsertBasket({ id: 'a', name: 'Чипы', tickers: ['SMH'] });
    all = await listBaskets();
    expect(all.length).toBe(2);
    expect(all.find((x) => x.id === 'a')!.name).toBe('Чипы');
  });

  it('пустой список тикеров отклоняется; delete удаляет', async () => {
    await expect(upsertBasket({ id: 'c', name: 'X', tickers: [] })).rejects.toThrow();
    await deleteBasket('b');
    expect((await listBaskets()).map((x) => x.id)).toEqual(['a']);
  });
});
