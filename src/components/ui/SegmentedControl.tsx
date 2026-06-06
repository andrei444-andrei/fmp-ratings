'use client';

import { cn } from './cn';

export interface SegmentOption<T extends string> {
  label: React.ReactNode;
  value: T;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-fk bg-surface-2 p-1',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[10px] font-semibold transition-colors whitespace-nowrap',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]',
              size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-sm',
              fullWidth && 'flex-1',
              active
                ? 'bg-surface-elev text-ink shadow-fk-sm'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
