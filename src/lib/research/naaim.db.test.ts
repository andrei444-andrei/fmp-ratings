// Интеграционный тест слоя NAAIM против локального libSQL-файла (без веб-сервера):
// ингест (upsert) → getNaaimForStudy отдаёт реальные данные с source='manual', а не синтетику.
// LOCAL_SQLITE_PATH задаём ДО первого обращения к БД (клиент libsql ленивый — читает env при первом execute).
process.env.LOCAL_SQLITE_PATH = `/tmp/naaim-it-${process.pid}.db`;

import { describe, it, expect, beforeAll } from 'vitest';
import { ingestNaaim, getNaaimForStudy, getNaaimStatus } from './naaim';
import { libsqlClient } from '@/db/client';

beforeAll(async () => {
  // Чистый старт: пересоздаём таблицу (файл уникален по pid, но на всякий случай).
  await libsqlClient.execute('DROP TABLE IF EXISTS naaim_exposure');
  await libsqlClient.execute('DROP TABLE IF EXISTS naaim_meta');
});

describe('NAAIM ingest → study (libSQL)', () => {
  it('ингест пишет недели и помечает source=manual; повторная загрузка — upsert без дублей', async () => {
    const rows = [
      { date: '2024-01-04', value: 40.5 },
      { date: '2024-01-11', value: 52 },
      { date: '2024-01-18', value: 61.3 },
      { date: '2024-01-25', value: 73.2 },
    ];
    const res = await ingestNaaim(rows, 'manual');
    expect(res.count).toBe(4);
    expect(res.first).toBe('2024-01-04');
    expect(res.last).toBe('2024-01-25');

    const status = await getNaaimStatus();
    expect(status.count).toBe(4);
    expect(status.source).toBe('manual');

    // Upsert: повтор той же даты с новым значением не плодит строку, а обновляет.
    await ingestNaaim([{ date: '2024-01-25', value: 99.9 }], 'manual');
    const after = await getNaaimStatus();
    expect(after.count).toBe(4);
    expect(after.rows.find((r) => r.date === '2024-01-25')?.value).toBe(99.9);
  });

  it('getNaaimForStudy отдаёт реальные (manual) данные, НЕ синтетику', async () => {
    const bundle = await getNaaimForStudy();
    expect(bundle.source).toBe('manual');
    expect(bundle.count).toBe(4);
    expect(bundle.rows[0].date).toBe('2024-01-04');
  });
});
