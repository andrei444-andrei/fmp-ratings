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

import { generateDescription, extractNotebookCode } from './describe';
import * as client from './client';

const notebook = (code: string) => JSON.stringify({
  cells: [
    { cell_type: 'markdown', source: ['# заметки'] },
    { cell_type: 'code', source: code.split('\n').map(l => l + '\n') },
  ],
  nbformat: 4,
});

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

  it('main.py пустой, код в research.ipynb → берём из ноутбука (реальный кейс)', async () => {
    (client.qcReadProjectFiles as any).mockResolvedValueOnce([
      { name: 'main.py', content: '' },
      { name: 'research.ipynb', content: notebook('class Alpha(QCAlgorithm):\n    def Initialize(self): pass') },
    ]);
    (client.qcReadProjectFile as any).mockResolvedValueOnce(''); // main.py пуст и пофайлово
    const out = await generateDescription('111');
    expect(out).toContain('Описание стратегии'); // не упало — код взят из .ipynb
  });
});

describe('extractNotebookCode', () => {
  it('достаёт только code-ячейки, пропуская markdown', () => {
    const raw = notebook('spy = qb.add_equity("SPY")');
    const code = extractNotebookCode(raw);
    expect(code).toContain('qb.add_equity');
    expect(code).not.toContain('заметки'); // markdown-ячейка отброшена
  });

  it('битый JSON → пустая строка (не падаем)', () => {
    expect(extractNotebookCode('{not json')).toBe('');
  });
});
