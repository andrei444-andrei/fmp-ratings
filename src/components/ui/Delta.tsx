import { cn } from './cn';

export interface DeltaProps {
  /** Числовое изменение. Знак определяет рост/падение. */
  value: number;
  /** Добавить «%» к значению. */
  percent?: boolean;
  /** Кол-во знаков после запятой (по умолчанию 2). */
  decimals?: number;
  /** Показывать стрелку ▲/▼. */
  showArrow?: boolean;
  /** 'text' — просто цветной текст; 'pill' — цветная плашка. */
  variant?: 'text' | 'pill';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Delta({
  value,
  percent,
  decimals = 2,
  showArrow = true,
  variant = 'text',
  size = 'md',
  className,
}: DeltaProps) {
  const positive = value >= 0;
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = positive ? '+' : '−';
  const arrow = positive ? '▲' : '▼';

  const sizeCls =
    size === 'lg' ? 'text-base' : size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-semibold tabular-nums whitespace-nowrap',
        sizeCls,
        positive ? 'text-up-strong' : 'text-down-strong',
        variant === 'pill' &&
          cn('rounded-fk-pill px-2 py-0.5', positive ? 'bg-up-soft' : 'bg-down-soft'),
        className,
      )}
    >
      {showArrow && <span className="text-[0.85em] leading-none">{arrow}</span>}
      {sign}
      {abs}
      {percent && '%'}
    </span>
  );
}
