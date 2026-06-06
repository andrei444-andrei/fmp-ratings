'use client';

import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-fk-pill transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        checked ? 'bg-brand' : 'bg-surface-2 border border-line-strong',
      )}
      {...aria}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-fk-pill bg-surface-elev shadow-fk-sm transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}
