// Генерация описания стратегии по её коду QuantConnect (AI через aimlapi).

import { qcReadProjectFiles, qcReadProjectFile } from './client';
import { aimlChat } from '@/lib/aimlapi';

export async function generateDescription(projectId: string): Promise<string> {
  const files = await qcReadProjectFiles(projectId);
  const codeFiles = files.filter(f => /\.(py|cs)$/i.test(f.name));
  // QC иногда отдаёт bulk /files/read со списком файлов, но БЕЗ content —
  // в таком случае добираем содержимое каждого файла кода пофайлово.
  // Диагностика: фиксируем длину content из bulk и после пофайлового добора,
  // чтобы при провале точно знать, где обрывается цепочка (а не гадать).
  const diag: string[] = [];
  await Promise.all(codeFiles.map(async f => {
    const bulkLen = f.content.length;
    if (!f.content.trim()) f.content = await qcReadProjectFile(projectId, f.name);
    diag.push(`${f.name}(bulk=${bulkLen},file=${f.content.length})`);
  }));
  const code = codeFiles
    .filter(f => f.content.trim())
    .map(f => `# ${f.name}\n${f.content}`)
    .join('\n\n')
    .slice(0, 24000); // лимит контекста
  if (!code.trim()) {
    // Самодиагностирующаяся ошибка: один прогон у пользователя показывает причину —
    // 0 файлов (креды/проект), файлы без .py/.cs (другие расширения) или пустой content.
    const all = files.map(f => `${f.name}=${f.content.length}`).slice(0, 30).join(', ');
    throw new Error(
      `В проекте нет кода (.py/.cs) с содержимым. Всего файлов: ${files.length}. ` +
      `Код-файлы [${diag.join(', ') || '—'}]. Все файлы [${all || 'пусто — /files/read ничего не вернул'}]`,
    );
  }

  const content = await aimlChat({
    messages: [
      {
        role: 'system',
        content:
          'Ты — квант-аналитик. По коду алгоритма QuantConnect кратко и по делу опиши стратегию на русском в Markdown: ' +
          'идея и логика входов/выходов, инструменты и таймфрейм, использование плеча и риск-контроль (стопы, контроль просадки), ' +
          'ребаланс/частота, заметные параметры. Используй заголовки/списки/жирный где уместно. Без воды и без преамбул — только описание.',
      },
      { role: 'user', content: 'Код алгоритма:\n\n```\n' + code + '\n```' },
    ],
    max_tokens: 800,
    temperature: 0.3,
  });
  return content.trim();
}
