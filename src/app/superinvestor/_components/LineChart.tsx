'use client';

import { useRef, useState } from 'react';

export type ChartSeries = { label: string; color: string; values: number[]; dash?: boolean };

type Props = {
  dates: string[];
  series: ChartSeries[];
  markers?: string[];          // даты-маркеры (филинги)
  markerColor?: string;
  height?: number;
  yFormat?: (v: number) => string;
  refLine?: number;            // горизонтальная опорная линия (напр. 1.0)
};

const W = 1000;
const PAD_L = 52, PAD_R = 14, PAD_T = 14, PAD_B = 26;

export default function LineChart({
  dates, series, markers = [], markerColor = '#7c6cf0',
  height = 320, yFormat = v => v.toFixed(2), refLine,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const H = height;
  const n = dates.length;

  const all = series.flatMap(s => s.values).filter(v => isFinite(v));
  if (!n || !all.length) {
    return <div className="si-state">Недостаточно данных для графика.</div>;
  }
  let min = Math.min(...all), max = Math.max(...all);
  if (refLine != null) { min = Math.min(min, refLine); max = Math.max(max, refLine); }
  if (min === max) { min -= 0.5; max += 0.5; }
  const pad = (max - min) * 0.06;
  min -= pad; max += pad;

  const x = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const y = (v: number) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B);

  const path = (vals: number[]) => {
    let d = '';
    let started = false;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!isFinite(v)) { started = false; continue; }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      started = true;
    }
    return d.trim();
  };

  // горизонтальные грид-линии
  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);

  // подписи дат по оси X
  const xLabels = n > 1
    ? [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1].map(i => ({ i, d: dates[i] }))
    : [{ i: 0, d: dates[0] }];

  // уникальные индексы маркеров
  const markerIdx = Array.from(new Set(markers.map(m => dates.indexOf(m)).filter(i => i >= 0)));

  function onMove(e: React.MouseEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;       // 0..1 по ширине рендера
    const vx = fx * W;                                     // координата во viewBox
    const frac = (vx - PAD_L) / (W - PAD_L - PAD_R);
    const i = Math.round(Math.max(0, Math.min(1, frac)) * (n - 1));
    setHoverIdx(i);
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
        {/* грид + подписи Y */}
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={y(gv)} x2={W - PAD_R} y2={y(gv)} stroke="rgba(255,255,255,.06)" strokeWidth={1} />
            <text x={PAD_L - 7} y={y(gv) + 3} textAnchor="end" fontSize={10} fill="#5d6470" fontFamily="ui-monospace, monospace">
              {yFormat(gv)}
            </text>
          </g>
        ))}

        {/* опорная линия */}
        {refLine != null && (
          <line x1={PAD_L} y1={y(refLine)} x2={W - PAD_R} y2={y(refLine)}
            stroke="rgba(255,255,255,.22)" strokeWidth={1} strokeDasharray="3 4" />
        )}

        {/* маркеры филингов */}
        {markerIdx.map((i, k) => (
          <line key={k} x1={x(i)} y1={PAD_T} x2={x(i)} y2={H - PAD_B}
            stroke={markerColor} strokeWidth={1} opacity={0.18} />
        ))}

        {/* серии */}
        {series.map((s, i) => (
          <path key={i} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={1.8}
            strokeDasharray={s.dash ? '5 4' : undefined}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* подписи X */}
        {xLabels.map((l, i) => (
          <text key={i} x={x(l.i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            fontSize={10} fill="#5d6470" fontFamily="ui-monospace, monospace">
            {l.d?.slice(0, 7)}
          </text>
        ))}

        {/* crosshair */}
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

      {/* подсказка значений */}
      {hoverIdx != null && (
        <div style={{ fontSize: 11.5, color: 'var(--hm-tx2)', marginTop: 4, fontFamily: 'var(--hm-mono)' }}>
          <span style={{ color: 'var(--hm-tx3)' }}>{dates[hoverIdx]}</span>
          {series.map((s, i) => (
            <span key={i} style={{ marginLeft: 12, color: s.color }}>
              {s.label} {yFormat(s.values[hoverIdx])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
