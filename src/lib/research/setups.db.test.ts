// Интеграционный тест слоя сетапов против локального libSQL-файла.
process.env.LOCAL_SQLITE_PATH = `/tmp/setups-it-${process.pid}.db`;

import { describe, it, expect, beforeAll } from 'vitest';
import { listSetups, getSetup, upsertSetup, deleteSetup } from './setups';
import { libsqlClient } from '@/db/client';

beforeAll(async () => {
  await libsqlClient.execute('DROP TABLE IF EXISTS research_setups');
});

const CFG = { uniText: 'XLK, XLF', blocks: [{ conds: [{ col: 'momentum_63', cmp: 'ge', val: 10, not: false }] }], horizon: 21, years: 10, view: 'all' as const };
const SNAP = { n: 42, tstat: 2.3, avgRet: 1.1, first: '2010-01-04', last: '2024-06-01' };
const STREAM = [['2010-03-01', 'XLK', 2.1, 0.4, 5.0, -1.2, -3.1], ['2010-04-12', 'XLF', -0.8, -0.3, 1.0, -2.0, -2.4]];

describe('research_setups (libSQL)', () => {
  it('upsert/list/получение с потоком/обновление', async () => {
    await upsertSetup({ id: 'a', name: 'Импульс ETF', description: 'момент 63д', config: CFG, snapshot: SNAP, stream: STREAM });
    await upsertSetup({ id: 'b', name: 'Перепроданность', config: { uniText: 'GLD', blocks: [{ conds: [] }] } });
    const all = await listSetups();
    expect(all.map((x) => x.id)).toEqual(['a', 'b']);
    // список — без потока
    expect((all[0] as any).stream).toBeUndefined();
    expect(all[0].snapshot.n).toBe(42);
    expect(all[0].config.horizon).toBe(21);
    // одиночный — с потоком
    const one = await getSetup('a');
    expect(one!.stream!.length).toBe(2);
    expect(one!.stream![0][1]).toBe('XLK');
    // обновление того же id
    await upsertSetup({ id: 'a', name: 'Импульс ETF+', config: CFG });
    expect((await listSetups()).find((x) => x.id === 'a')!.name).toBe('Импульс ETF+');
  });

  it('пустое имя отклоняется; delete удаляет', async () => {
    await expect(upsertSetup({ id: 'c', name: '', config: CFG })).rejects.toThrow();
    await deleteSetup('b');
    expect((await listSetups()).map((x) => x.id)).toEqual(['a']);
  });
});
