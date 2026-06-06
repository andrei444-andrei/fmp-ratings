import { cn } from './cn';

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  /** Залить площадь под линией. */
  fill?: boolean;
  /** Принудительный цвет: по умолчанию up/down по знаку (последнее vs первое). */
  tone?: 'up' | 'down' | 'auto';
  className?: string;
}

export function Sparkline({
  data,
  width = 120,
  height = 36,
  strokeWidth = 2,
  fill = true,
  tone = 'auto',
  className,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = strokeWidth;
  const innerH = height - pad * 2;
  const stepX = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  const positive = tone === 'auto' ? data[data.length - 1] >= data[0] : tone === 'up';
  const color = positive ? 'var(--fk-up)' : 'var(--fk-down)';
  const gradId = `fk-spark-${positive ? 'up' : 'down'}`;

  return (
    <svg
      className={cn('block', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} />
        </>
      )}
      <path d={line} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
