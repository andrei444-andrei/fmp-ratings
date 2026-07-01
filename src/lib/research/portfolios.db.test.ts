// Интеграционный тест слоя портфелей против локального libSQL-файла.
process.env.LOCAL_SQLITE_PATH = `/tmp/portfolios-it-${process.pid}.db`;

import { describe, it, expect, beforeAll } from 'vitest';
import { listPortfolios, getPortfolio, upsertPortfolio, updatePortfolioMeta, deletePortfolio } from './portfolios';
import { libsqlClient } from '@/db/client';

beforeAll(async () => {
  await libsqlClient.execute('DROP TABLE IF EXISTS research_portfolios');
});

describe('research_portfolios (libSQL)', () => {
  it('upsert/list/get + нормализация config', async () => {
    await upsertPortfolio({ id: 'p1', name: 'Импульс-микс', description: 'лестница 5, BIL', config: { setupIds: ['a', 'b', 'a'], execution: 'ladder', ladderN: 5, parking: 'BIL' } });
    await upsertPortfolio({ id: 'p2', name: 'Недельный SPY', config: { setupIds: ['c'], execution: 'weekly', parking: 'SPY' } });
    const all = await listPortfolios();
    expect([...all.map((x) => x.id)].sort()).toEqual(['p1', 'p2']); // порядок = избранные/свежие, проверяем состав
    const a = all.find((x) => x.id === 'p1')!;
    const b = all.find((x) => x.id === 'p2')!;
    // дедуп id сетапов + параметры сборки сохранены
    expect(a.config.setupIds).toEqual(['a', 'b']);
    expect(a.config.execution).toBe('ladder');
    expect(a.config.ladderN).toBe(5);
    expect(a.config.parking).toBe('BIL');
    expect(a.config.maxWeight).toBe(0); // потолок по умолчанию — без лимита
    expect(a.favorite).toBe(false);
    // execution weekly; ladderN → дефолт 5
    expect(b.config.execution).toBe('weekly');
    expect(b.config.ladderN).toBe(5);
    expect(b.config.parking).toBe('SPY');

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

  it('избранное закрепляется сверху; снимок метрик и точечное обновление', async () => {
    await upsertPortfolio({ id: 'fa', name: 'Фав A', config: { setupIds: ['a'], parking: 'BIL' } });
    await upsertPortfolio({ id: 'fb', name: 'Фав B', config: { setupIds: ['b'], parking: 'BIL' }, snapshot: { cagr: 0.2, loading: 0.5 } });
    // снимок метрик сохранён при создании
    expect((await getPortfolio('fb'))!.snapshot?.cagr).toBe(0.2);
    // помечаем fa избранным → в списке fa раньше fb (избранные сверху)
    await updatePortfolioMeta('fa', { favorite: true });
    const ids = (await listPortfolios()).map((x) => x.id).filter((id) => id === 'fa' || id === 'fb');
    expect(ids).toEqual(['fa', 'fb']);
    expect((await getPortfolio('fa'))!.favorite).toBe(true);
    // точечное обновление снимка НЕ трёт config/name
    await updatePortfolioMeta('fb', { snapshot: { cagr: 0.9 } });
    const fb = (await getPortfolio('fb'))!;
    expect(fb.snapshot?.cagr).toBe(0.9);
    expect(fb.name).toBe('Фав B');
    // upsert без снимка НЕ обнуляет ранее сохранённый снимок (COALESCE)
    await upsertPortfolio({ id: 'fb', name: 'Фав B2', config: { setupIds: ['b'], parking: 'BIL' } });
    expect((await getPortfolio('fb'))!.snapshot?.cagr).toBe(0.9);
  });
});
