'use client';

import { useRef, useState } from 'react';

export type Series = { label: string; color: string; values: number[]; dash?: boolean };
export type Marker = { date: string; color: string; label: string; cat: string };

type Props = {
  dates: string[];
  series: Series[];
  markers?: Marker[];
  height?: number;
  yFormat?: (v: number) => string;
  refLine?: number;
  log?: boolean;
};

const W = 1000;
const PAD_L = 56, PAD_R = 14, PAD_T = 14, PAD_B = 28;

function nearestIndex(dates: string[], date: string): number {
  let lo = 0, hi = dates.length - 1;
  if (date <= dates[0]) return 0;
  if (date >= dates[hi]) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] === date) return mid;
    if (dates[mid] < date) lo = mid + 1; else hi = mid - 1;
  }
  // lo = insertion point; pick closer neighbour
  const a = Math.max(0, hi), b = Math.min(dates.length - 1, lo);
  return Math.abs(+new Date(dates[a]) - +new Date(date)) <= Math.abs(+new Date(dates[b]) - +new Date(date)) ? a : b;
}

export default function PriceChart({
  dates, series, markers = [], height = 360, yFormat = v => v.toFixed(2), refLine, log = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const H = height;
  const n = dates.length;

  const all = series.flatMap(s => s.values).filter(v => isFinite(v) && (!log || v > 0));
  if (!n || !all.length) return <div className="si-state">Недостаточно данных для графика.</div>;

  let min = Math.min(...all), max = Math.max(...all);
  if (!log && refLine != null) { min = Math.min(min, refLine); max = Math.max(max, refLine); }
  if (min === max) { min -= 0.5; max += 0.5; }

  const tf = (v: number) => (log ? Math.log(Math.max(v, 1e-9)) : v);
  let lo = tf(min), hi = tf(max);
  const pad = (hi - lo) * 0.06;
  lo -= pad; hi += pad;

  const x = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const y = (v: number) => PAD_T + (1 - (tf(v) - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const path = (vals: number[]) => {
    let d = '', started = false;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!isFinite(v) || (log && v <= 0)) { started = false; continue; }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      started = true;
    }
    return d.trim();
  };

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => {
    const t = lo + ((hi - lo) * i) / ticks;
    return log ? Math.exp(t) : t;
  });

  const xLabels = n > 1
    ? [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1].map(i => ({ i, d: dates[i] }))
    : [{ i: 0, d: dates[0] }];

  const mk = markers.map(m => ({ ...m, i: nearestIndex(dates, m.date) }));
  const hoverEvents = hoverIdx != null ? mk.filter(m => m.i === hoverIdx).slice(0, 4) : [];

  function onMove(e: React.MouseEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const frac = ((e.clientX - rect.left) / rect.width * W - PAD_L) / (W - PAD_L - PAD_R);
    setHoverIdx(Math.round(Math.max(0, Math.min(1, frac)) * (n - 1)));
  }

  return (
    <div className="si-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={y(gv)} x2={W - PAD_R} y2={y(gv)} stroke="rgba(255,255,255,.06)" strokeWidth={1} />
            <text x={PAD_L - 7} y={y(gv) + 3} textAnchor="end" fontSize={10} fill="#5d6470" fontFamily="ui-monospace, monospace">
              {yFormat(gv)}
            </text>
          </g>
        ))}

        {!log && refLine != null && (
          <line x1={PAD_L} y1={y(refLine)} x2={W - PAD_R} y2={y(refLine)}
            stroke="rgba(255,255,255,.22)" strokeWidth={1} strokeDasharray="3 4" />
        )}

        {/* маркеры событий */}
        {mk.map((m, k) => (
          <line key={k} x1={x(m.i)} y1={PAD_T} x2={x(m.i)} y2={H - PAD_B}
            stroke={m.color} strokeWidth={1} opacity={hoverIdx === m.i ? 0.7 : 0.22} />
        ))}

        {series.map((s, i) => (
          <path key={i} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={1.8}
            strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {xLabels.map((l, i) => (
          <text key={i} x={x(l.i)} y={H - 9}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            fontSize={10} fill="#5d6470" fontFamily="ui-monospace, monospace">
            {l.d?.slice(0, 7)}
          </text>
        ))}

        {hoverIdx != null && (
          <>
            <line x1={x(hoverIdx)} y1={PAD_T} x2={x(hoverIdx)} y2={H - PAD_B} stroke="rgba(255,255,255,.3)" strokeWidth={1} />
            {series.map((s, i) => {
              const v = s.values[hoverIdx];
              if (!isFinite(v)) return null;
              return <circle key={i} cx={x(hoverIdx)} cy={y(v)} r={3} fill={s.color} />;
            })}
          </>
        )}
      </svg>

      {hoverIdx != null && (
        <div style={{ fontSize: 11.5, color: 'var(--hm-tx2)', marginTop: 4, fontFamily: 'var(--hm-mono)' }}>
          <span style={{ color: 'var(--hm-tx3)' }}>{dates[hoverIdx]}</span>
          {series.map((s, i) => (
            <span key={i} style={{ marginLeft: 12, color: s.color }}>
              {s.label} {yFormat(s.values[hoverIdx])}
            </span>
          ))}
          {hoverEvents.map((m, i) => (
            <div key={i} className="tk-tip-ev">
              <span className="dot" style={{ background: m.color }} />
              <span style={{ color: 'var(--hm-tx2)' }}>{m.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
