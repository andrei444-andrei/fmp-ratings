'use client';

import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

// Рендер Markdown (описания стратегий — авторские/AI). Скрипты вырезаем.
export default function Markdown({ text, className }: { text: string; className?: string }) {
  const html = (marked.parse(text || '', { async: false }) as string).replace(/<script[\s\S]*?<\/script>/gi, '');
  return <div className={'qc-md' + (className ? ' ' + className : '')} dangerouslySetInnerHTML={{ __html: html }} />;
}
