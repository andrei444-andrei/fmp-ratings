// Интеграционный тест слоя пресетов настроек против локального libSQL-файла.
process.env.LOCAL_SQLITE_PATH = `/tmp/presets-it-${process.pid}.db`;

import { describe, it, expect, beforeAll } from 'vitest';
import { listPresets, upsertPreset, deletePreset } from './presets';
import { libsqlClient } from '@/db/client';

beforeAll(async () => {
  await libsqlClient.execute('DROP TABLE IF EXISTS research_presets');
});

const BLOCKS = [{ conds: [{ col: 'momentum_63', cmp: 'ge', val: 10, not: false }] }];

describe('research_presets (libSQL)', () => {
  it('upsert/list/обновление/нормализация конфигурации', async () => {
    await upsertPreset({ id: 'a', name: 'Импульс', description: 'моментум 63д', config: { blocks: BLOCKS, display: ['momentum_63'], horizon: 21, years: 10, view: 'tickers' } });
    await upsertPreset({ id: 'b', name: 'Перепроданность', config: { blocks: [{ conds: [{ col: 'rsi_14', cmp: 'le', val: 30, not: false }] }] } });
    let all = await listPresets();
    expect(all.map((x) => x.id)).toEqual(['a', 'b']);
    const a = all.find((x) => x.id === 'a')!;
    expect(a.description).toBe('моментум 63д');
    expect(a.config.horizon).toBe(21);
    expect(a.config.view).toBe('tickers');
    expect(Array.isArray(a.config.blocks)).toBe(true);
    // обновление того же id
    await upsertPreset({ id: 'a', name: 'Импульс+', description: '', config: { blocks: BLOCKS } });
    all = await listPresets();
    expect(all.length).toBe(2);
    expect(all.find((x) => x.id === 'a')!.name).toBe('Импульс+');
  });

  it('пустые блоки и пустое имя отклоняются; delete удаляет', async () => {
    await expect(upsertPreset({ id: 'c', name: 'X', config: { blocks: [] } })).rejects.toThrow();
    await expect(upsertPreset({ id: 'd', name: '', config: { blocks: BLOCKS } })).rejects.toThrow();
    await deletePreset('b');
    expect((await listPresets()).map((x) => x.id)).toEqual(['a']);
  });
});
