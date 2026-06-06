'use client';

import { forwardRef } from 'react';
import { cn } from './cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full min-h-[104px] rounded-fk border bg-surface-elev text-ink text-[15px] px-3.5 py-2.5 resize-y',
        'placeholder:text-ink-3 transition-colors leading-relaxed',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]',
        invalid ? 'border-down' : 'border-line-strong focus-visible:border-brand',
        className,
      )}
      {...props}
    />
  );
});
