// Интеграционный тест слоя портфелей против локального libSQL-файла.
process.env.LOCAL_SQLITE_PATH = `/tmp/portfolios-it-${process.pid}.db`;

import { describe, it, expect, beforeAll } from 'vitest';
import { listPortfolios, getPortfolio, upsertPortfolio, deletePortfolio } from './portfolios';
import { libsqlClient } from '@/db/client';

beforeAll(async () => {
  await libsqlClient.execute('DROP TABLE IF EXISTS research_portfolios');
});

describe('research_portfolios (libSQL)', () => {
  it('upsert/list/get + нормализация config', async () => {
    await upsertPortfolio({ id: 'p1', name: 'Импульс-микс', description: 'топ-5, BIL', config: { setupIds: ['a', 'b', 'a'], maxConcurrent: 5, parking: 'BIL', weighting: 'equal' } });
    await upsertPortfolio({ id: 'p2', name: 'Парковка SPY', config: { setupIds: ['c'], maxConcurrent: 0, parking: 'SPY' } });
    const all = await listPortfolios();
    expect(all.map((x) => x.id)).toEqual(['p1', 'p2']);
    // дедуп тикеров-сетапов + лимит сохранён
    expect(all[0].config.setupIds).toEqual(['a', 'b']);
    expect(all[0].config.maxConcurrent).toBe(5);
    expect(all[0].config.parking).toBe('BIL');
    // maxConcurrent 0 → null (без лимита)
    expect(all[1].config.maxConcurrent).toBeNull();
    expect(all[1].config.parking).toBe('SPY');

    const one = await getPortfolio('p1');
    expect(one!.name).toBe('Импульс-микс');

    // обновление того же id
    await upsertPortfolio({ id: 'p1', name: 'Импульс-микс+', config: { setupIds: ['a'], parking: 'CASH' } });
    expect((await listPortfolios()).find((x) => x.id === 'p1')!.name).toBe('Импульс-микс+');
  });

  it('пустой список сетапов и пустое имя отклоняются; delete удаляет', async () => {
    await expect(upsertPortfolio({ id: 'x', name: 'Без сетапов', config: { setupIds: [], parking: 'BIL' } })).rejects.toThrow();
    await expect(upsertPortfolio({ id: 'y', name: '', config: { setupIds: ['a'], parking: 'BIL' } })).rejects.toThrow();
    await deletePortfolio('p2');
    expect((await listPortfolios()).map((x) => x.id)).toEqual(['p1']);
  });
});
