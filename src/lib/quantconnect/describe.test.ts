import { describe, it, expect, vi } from 'vitest';

// QC иногда отдаёт bulk /files/read со списком файлов БЕЗ content — describe должен
// добрать содержимое пофайлово (qcReadProjectFile), а не падать с «нет кода».
vi.mock('./client', () => ({
  qcReadProjectFiles: vi.fn(async () => [{ name: 'main.py', content: '' }, { name: 'readme.md', content: 'doc' }]),
  qcReadProjectFile: vi.fn(async (_p: any, name: string) => (name === 'main.py' ? 'class Alpha(QCAlgorithm):\n    pass' : '')),
}));
vi.mock('@/lib/aimlapi', () => ({
  aimlChat: vi.fn(async () => '## Описание стратегии'),
}));

import { generateDescription } from './describe';
import * as client from './client';

describe('generateDescription', () => {
  it('bulk-файлы без content → добор пофайлово → описание генерируется', async () => {
    const out = await generateDescription('111');
    expect(out).toContain('Описание стратегии'); // не упало с «нет кода»
    expect(client.qcReadProjectFile).toHaveBeenCalledWith('111', 'main.py');
  });

  it('кода нет совсем → ошибка со списком файлов проекта (диагностика)', async () => {
    (client.qcReadProjectFiles as any).mockResolvedValueOnce([{ name: 'data.csv', content: '' }]);
    await expect(generateDescription('111')).rejects.toThrow(/Файлы проекта: data\.csv/);
  });
});
