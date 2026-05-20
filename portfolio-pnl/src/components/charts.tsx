'use client';

import { ASSET_CLASS_COLOR } from '@/lib/types';
import { fmtMoney, fmtQuarter } from '@/lib/format';
import type { OverviewData } from '@/lib/compute';

// --- Line chart: поквартальный net worth ---
export function NetWorthChart({ series, mode }: { series: OverviewData['series']; mode: 'abs' | 'twr' }) {
  if (series.length < 2) {
    return <div className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>Нужно ≥ 2 кварталов для графика</div>;
  }
  const W = 880, H = 200, padL = 60, padR = 20, padT = 20, padB = 30;

  let pts: { x: number; y: number; label: string; raw: number }[];
  if (mode === 'twr') {
    // Индекс роста от 100 (нормировано на первый квартал).
    const base = series[0].value || 1;
    pts = series.map((s) => ({ raw: (s.value / base) * 100, label: s.quarter, x: 0, y: 0 }));
  } else {
    pts = series.map((s) => ({ raw: s.value, label: s.quarter, x: 0, y: 0 }));
  }
  const values = pts.map((p) => p.raw);
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pad = span * 0.15;
  const lo = min - pad, hi = max + pad, range = hi - lo || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  pts = pts.map((p, i) => ({
    ...p,
    x: padL + (innerW * i) / (pts.length - 1),
    y: padT + innerH * (1 - (p.raw - lo) / range),
  }));

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)},${padT + innerH} L ${pts[0].x.toFixed(1)},${padT + innerH} Z`;
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + range * t);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {gridVals.map((gv, i) => {
        const y = padT + innerH * (1 - (gv - lo) / range);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#D3D1C7" strokeWidth="0.5" strokeDasharray={i === 0 ? undefined : '2 3'} />
            <text x={padL - 6} y={y + 3} fontSize="10" fill="#888780" textAnchor="end">
              {mode === 'twr' ? gv.toFixed(0) : fmtMoney(gv, { compact: true })}
            </text>
          </g>
        );
      })}
      <path d={area} fill="#B5D4F4" opacity="0.35" />
      <path d={line} fill="none" stroke="#185FA5" strokeWidth="2.5" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={i === pts.length - 1 ? 6 : 4} fill="#185FA5" stroke={i === pts.length - 1 ? '#fff' : 'none'} strokeWidth={i === pts.length - 1 ? 2 : 0} />
          <text x={p.x} y={H - 8} fontSize="11" fill={i === pts.length - 1 ? '#1F1F1E' : '#5F5E5A'} fontWeight={i === pts.length - 1 ? 500 : 400} textAnchor="middle">
            {fmtQuarter(p.label)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// --- Donut: аллокация по классам ---
export function AllocationDonut({ allocation, total }: { allocation: OverviewData['allocation']; total: number }) {
  const R = 40, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" style={{ width: 110, height: 110, flexShrink: 0 }}>
      {allocation.map((a) => {
        const frac = total ? a.value / total : 0;
        const len = C * frac;
        const seg = (
          <circle
            key={a.assetClass}
            cx="50" cy="50" r={R} fill="none"
            stroke={ASSET_CLASS_COLOR[a.assetClass]}
            strokeWidth="16"
            strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`}
            strokeDashoffset={(-offset).toFixed(2)}
            transform="rotate(-90 50 50)"
          />
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
}

// --- Waterfall: P&L bridge ---
export function BridgeChart({ bridge }: { bridge: OverviewData['bridge'] }) {
  const { startValue, endValue, steps, startQuarter, endQuarter } = bridge;
  const W = 480, H = 180, top = 20, bottom = 150, plotH = bottom - top;
  const maxV = Math.max(startValue, endValue, 1);
  const scale = plotH / maxV;
  const cols = steps.length + 2;
  const colW = Math.min(50, (W - 40) / cols);
  const gap = (W - 40 - colW * cols) / (cols + 1);
  let x = 20 + gap;
  const yOf = (v: number) => bottom - v * scale;

  const bars: React.ReactNode[] = [];
  // Start
  bars.push(
    <g key="start">
      <rect x={x} y={yOf(startValue)} width={colW} height={startValue * scale} fill="#B4B2A9" rx="3" />
      <text x={x + colW / 2} y={bottom + 15} fontSize="11" fill="#5F5E5A" textAnchor="middle">{startQuarter ? fmtQ(startQuarter) : 'старт'}</text>
      <text x={x + colW / 2} y={yOf(startValue) - 6} fontSize="11" fill="#1F1F1E" textAnchor="middle" fontWeight="500">{fmtMoney(startValue, { compact: true })}</text>
    </g>,
  );
  let running = startValue;
  let prevX = x;
  x += colW + gap;
  steps.forEach((s, i) => {
    const from = running;
    running += s.delta;
    const barTop = yOf(Math.max(from, running));
    const barH = Math.abs(s.delta) * scale;
    const positive = s.delta >= 0;
    bars.push(
      <g key={i}>
        <line x1={prevX + colW} y1={yOf(from)} x2={x} y2={yOf(from)} stroke="#B4B2A9" strokeWidth="0.5" strokeDasharray="2 2" />
        <rect x={x} y={barTop} width={colW} height={Math.max(barH, 1.5)} fill={positive ? '#97C459' : '#E24B4A'} rx="2" />
        <text x={x + colW / 2} y={bottom + 15} fontSize="10" fill="#5F5E5A" textAnchor="middle">{s.label.split(' ')[0]}</text>
        <text x={x + colW / 2} y={barTop - 5} fontSize="10" fill={positive ? '#27500A' : '#791F1F'} textAnchor="middle" fontWeight="500">
          {positive ? '+' : '−'}{fmtMoney(Math.abs(s.delta), { compact: true })}
        </text>
      </g>,
    );
    prevX = x;
    x += colW + gap;
  });
  // End
  bars.push(
    <g key="end">
      <line x1={prevX + colW} y1={yOf(endValue)} x2={x} y2={yOf(endValue)} stroke="#444441" strokeWidth="0.5" strokeDasharray="2 2" />
      <rect x={x} y={yOf(endValue)} width={colW} height={endValue * scale} fill="#444441" rx="3" />
      <text x={x + colW / 2} y={bottom + 15} fontSize="11" fill="#1F1F1E" textAnchor="middle" fontWeight="500">{endQuarter ? fmtQ(endQuarter) : 'итог'}</text>
      <text x={x + colW / 2} y={yOf(endValue) - 6} fontSize="11" fill="#1F1F1E" textAnchor="middle" fontWeight="500">{fmtMoney(endValue, { compact: true })}</text>
    </g>,
  );

  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>{bars}</svg>;
}

function fmtQ(q: string): string {
  return fmtQuarter(q);
}
