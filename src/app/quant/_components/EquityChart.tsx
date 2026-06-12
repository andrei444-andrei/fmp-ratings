'use client';

// Минималистичный SVG-график кривых капитала (лог-шкала по умолчанию — кривые
// капитала растут мультипликативно). Адаптивная ширина через viewBox.
export type ChartLine = { label: string; color: string; values: number[]; dash?: boolean };

export default function EquityChart({
  lines, xTicks, height = 300, logScale = true,
}: { lines: ChartLine[]; xTicks?: { pos: number; text: string }[]; height?: number; logScale?: boolean }) {
  const W = 1000, H = height, padL = 6, padR = 56, padT = 12, padB = 20;
  const all = lines.flatMap(l => l.values).filter(v => isFinite(v) && v > 0);
  if (!all.length) return <div className="qc-state">Недостаточно данных для графика.</div>;
  const tf = (v: number) => (logScale ? Math.log(v) : v);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo *= 0.99; hi *= 1.01; }
  const ylo = tf(lo), yhi = tf(hi);
  const N = Math.max(...lines.map(l => l.values.length));
  const xAt = (i: number) => padL + (W - padL - padR) * (N <= 1 ? 0 : i / (N - 1));
  const yAt = (v: number) => { const t = (tf(v) - ylo) / (yhi - ylo || 1); return padT + (H - padT - padB) * (1 - t); };

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v > 0 ? v : lo).toFixed(1)}`).join(' ');

  const oneY = lo <= 1 && hi >= 1 ? yAt(1) : null; // линия старта (×1)

  return (
    <svg className="qc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {oneY != null && (
        <>
          <line x1={padL} x2={W - padR} y1={oneY} y2={oneY} stroke="var(--qc-line2)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          <text x={W - padR + 4} y={oneY + 3} className="qc-chart-lbl">×1</text>
        </>
      )}
      {xTicks?.map((t, i) => (
        <text key={i} x={xAt(t.pos)} y={H - 6} className="qc-chart-xt" textAnchor="middle">{t.text}</text>
      ))}
      {lines.map((l, i) => {
        const last = l.values[l.values.length - 1];
        return (
          <g key={i}>
            <path d={path(l.values)} fill="none" stroke={l.color} strokeWidth={2}
              strokeDasharray={l.dash ? '5 4' : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {isFinite(last) && last > 0 && (
              <text x={W - padR + 4} y={yAt(last) + 3} className="qc-chart-lbl" fill={l.color}>×{last.toFixed(last >= 10 ? 0 : 1)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
