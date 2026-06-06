import { cn } from './cn';

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Обычно <Delta /> или <Badge />. */
  trend?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}

export function Stat({ label, value, trend, hint, className }: StatProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <span className="mt-1 text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight text-ink">
        {value}
      </span>
      {(trend || hint) && (
        <div className="mt-2 flex items-center gap-2">
          {trend}
          {hint && <span className="text-xs text-ink-3">{hint}</span>}
        </div>
      )}
    </div>
  );
}
