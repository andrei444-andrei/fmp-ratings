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
    await upsertPortfolio({ id: 'p1', name: 'Импульс-микс', description: 'лестница 5, BIL', config: { setupIds: ['a', 'b', 'a'], execution: 'ladder', ladderN: 5, parking: 'BIL' } });
    await upsertPortfolio({ id: 'p2', name: 'Недельный SPY', config: { setupIds: ['c'], execution: 'weekly', parking: 'SPY' } });
    const all = await listPortfolios();
    expect(all.map((x) => x.id)).toEqual(['p1', 'p2']);
    // дедуп id сетапов + параметры сборки сохранены
    expect(all[0].config.setupIds).toEqual(['a', 'b']);
    expect(all[0].config.execution).toBe('ladder');
    expect(all[0].config.ladderN).toBe(5);
    expect(all[0].config.parking).toBe('BIL');
    // execution weekly; ladderN → дефолт 5
    expect(all[1].config.execution).toBe('weekly');
    expect(all[1].config.ladderN).toBe(5);
    expect(all[1].config.parking).toBe('SPY');

    const one = await getPortfolio('p1');
    expect(one!.name).toBe('Импульс-микс');

    // обновление того же id
    await upsertPortfolio({ id: 'p1', name: 'Импульс-микс+', config: { setupIds: ['a'], execution: 'monthly', parking: 'CASH' } });
    const p1 = (await listPortfolios()).find((x) => x.id === 'p1')!;
    expect(p1.name).toBe('Импульс-микс+');
    expect(p1.config.execution).toBe('monthly');
  });

  it('пустой список сетапов и пустое имя отклоняются; delete удаляет', async () => {
    await expect(upsertPortfolio({ id: 'x', name: 'Без сетапов', config: { setupIds: [], parking: 'BIL' } })).rejects.toThrow();
    await expect(upsertPortfolio({ id: 'y', name: '', config: { setupIds: ['a'], parking: 'BIL' } })).rejects.toThrow();
    await deletePortfolio('p2');
    expect((await listPortfolios()).map((x) => x.id)).toEqual(['p1']);
  });
});
