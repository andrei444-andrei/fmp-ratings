import { cn } from './cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-fk',
        'bg-[linear-gradient(90deg,var(--fk-surface-2)_25%,#f8fafc_50%,var(--fk-surface-2)_75%)]',
        'bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
