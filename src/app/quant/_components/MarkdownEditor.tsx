'use client';

import { useRef, useState } from 'react';
import Markdown from './Markdown';

// Markdown-редактор с панелью стилей и превью + опц. кнопкой AI-генерации.
export default function MarkdownEditor({
  value, onChange, onGenerate, generating, placeholder, rows = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onGenerate?: () => void;
  generating?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function surround(before: string, after = before, ph = 'текст') {
    const ta = ref.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = value.slice(s, e) || ph;
    onChange(value.slice(0, s) + before + sel + after + value.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; });
  }
  function linePrefix(prefix: string) {
    const ta = ref.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const block = value.slice(lineStart, e) || 'пункт';
    const prefixed = block.split('\n').map(l => prefix + l).join('\n');
    onChange(value.slice(0, lineStart) + prefixed + value.slice(e));
    requestAnimationFrame(() => ta.focus());
  }

  return (
    <div className="qc-mde">
      <div className="qc-mde-bar">
        <button type="button" className="qc-mde-btn" title="Жирный" onClick={() => surround('**')}><b>B</b></button>
        <button type="button" className="qc-mde-btn" title="Курсив" onClick={() => surround('*')}><i>I</i></button>
        <button type="button" className="qc-mde-btn" title="Заголовок" onClick={() => linePrefix('## ')}>H</button>
        <button type="button" className="qc-mde-btn" title="Список" onClick={() => linePrefix('- ')}>•</button>
        <button type="button" className="qc-mde-btn" title="Нумерация" onClick={() => linePrefix('1. ')}>1.</button>
        <button type="button" className="qc-mde-btn" title="Цитата" onClick={() => linePrefix('> ')}>❝</button>
        <button type="button" className="qc-mde-btn" title="Код" onClick={() => surround('`')}>{'</>'}</button>
        <button type="button" className="qc-mde-btn" title="Ссылка" onClick={() => surround('[', '](https://)', 'текст')}>🔗</button>
        <span className="qc-spacer" />
        {onGenerate && (
          <button type="button" className="qc-btn primary qc-mde-gen" onClick={onGenerate} disabled={generating}>
            {generating ? '…генерация' : '✨ Сгенерировать из кода'}
          </button>
        )}
        <span className="qc-seg">
          <button type="button" className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>Текст</button>
          <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview(true)}>Превью</button>
        </span>
      </div>
      {preview ? (
        <div className="qc-mde-preview">{value.trim() ? <Markdown text={value} /> : <span className="qc-mut">Пусто</span>}</div>
      ) : (
        <textarea ref={ref} className="qc-input qc-mde-ta" rows={rows} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}
