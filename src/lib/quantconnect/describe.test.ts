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

  it('кода нет совсем → самодиагностирующаяся ошибка со списком файлов и длинами', async () => {
    (client.qcReadProjectFiles as any).mockResolvedValueOnce([{ name: 'data.csv', content: '' }]);
    await expect(generateDescription('111')).rejects.toThrow(/Все файлы \[data\.csv=0\]/);
  });

  it('пустой content даже после добора → диагностика показывает bulk=0,file=0', async () => {
    (client.qcReadProjectFiles as any).mockResolvedValueOnce([{ name: 'main.py', content: '' }]);
    (client.qcReadProjectFile as any).mockResolvedValueOnce(''); // и пофайлово пусто
    await expect(generateDescription('111')).rejects.toThrow(/main\.py\(bulk=0,file=0\)/);
  });
});
