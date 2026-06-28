// Интеграционный тест слоя формул против локального libSQL-файла (без веб-сервера):
// upsert → list (порядок created_at) → повторный upsert (обновление без дублей) → delete.
// LOCAL_SQLITE_PATH задаём ДО первого обращения к БД (клиент libsql ленивый).
process.env.LOCAL_SQLITE_PATH = `/tmp/formulas-it-${process.pid}.db`;

import { describe, it, expect, beforeAll } from 'vitest';
import { listFormulas, upsertFormula, deleteFormula } from './formulas';
import { libsqlClient } from '@/db/client';

beforeAll(async () => {
  await libsqlClient.execute('DROP TABLE IF EXISTS research_formulas');
});

describe('research_formulas (libSQL)', () => {
  it('upsert сохраняет, list отдаёт по порядку, повтор id обновляет без дублей', async () => {
    await upsertFormula({ id: 'a', name: 'avgMom3', expr: 'avg(momentum[21], momentum[63], momentum[126])' });
    await upsertFormula({ id: 'b', name: 'spread', expr: 'momentum[21] - momentum[252]' });
    let all = await listFormulas();
    expect(all.map((f) => f.id)).toEqual(['a', 'b']);
    expect(all.find((f) => f.id === 'a')!.name).toBe('avgMom3');

    // upsert того же id → обновление, не дубль
    await upsertFormula({ id: 'a', name: 'avgMom3', expr: 'avg(momentum[10], momentum[21])' });
    all = await listFormulas();
    expect(all.length).toBe(2);
    expect(all.find((f) => f.id === 'a')!.expr).toBe('avg(momentum[10], momentum[21])');
  });

  it('пустые поля отклоняются; delete удаляет', async () => {
    await expect(upsertFormula({ id: 'c', name: '', expr: 'x' })).rejects.toThrow();
    await deleteFormula('b');
    const all = await listFormulas();
    expect(all.map((f) => f.id)).toEqual(['a']);
  });
});
