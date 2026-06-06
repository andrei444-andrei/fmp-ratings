import { cn } from './cn';

export type BadgeVariant = 'neutral' | 'brand' | 'up' | 'down' | 'warn';

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand-50 text-brand-700',
  up: 'bg-up-soft text-up-strong',
  down: 'bg-down-soft text-down-strong',
  warn: 'bg-warn-soft text-warn-strong',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

export function Badge({ variant = 'neutral', size = 'md', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-fk-pill font-semibold whitespace-nowrap',
        size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
