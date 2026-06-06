'use client';

import { forwardRef } from 'react';
import { cn } from './cn';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  invalid?: boolean;
  leftIcon?: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, leftIcon, prefix, suffix, className, ...props },
  ref,
) {
  const field = (
    <input
      ref={ref}
      className={cn(
        'w-full h-11 rounded-fk border bg-surface-elev text-ink text-[15px]',
        'placeholder:text-ink-3 transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]',
        invalid
          ? 'border-down focus-visible:border-down'
          : 'border-line-strong focus-visible:border-brand',
        leftIcon ? 'pl-10' : prefix ? 'pl-8' : 'pl-3.5',
        suffix ? 'pr-10' : 'pr-3.5',
        className,
      )}
      {...props}
    />
  );

  if (!leftIcon && !prefix && !suffix) return field;

  return (
    <div className="relative">
      {leftIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 [&_svg]:w-5 [&_svg]:h-5">
          {leftIcon}
        </span>
      )}
      {prefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2 font-medium">
          {prefix}
        </span>
      )}
      {field}
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">
          {suffix}
        </span>
      )}
    </div>
  );
});
