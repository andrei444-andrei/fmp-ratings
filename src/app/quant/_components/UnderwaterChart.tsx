'use client';

// Underwater-график: «насколько капитал ниже исторического пика». 0 сверху, просадки вниз.
// Несколько линий (напр. портфель + бенчмарк). Цвета передаются hex.
export type UwLine = { label: string; color: string; uw: number[]; fill?: boolean; dash?: boolean };

function fmtPct0(v: number): string {
  if (!isFinite(v)) return '';
  const p = v * 100;
  return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(0) + '%';
}

export default function UnderwaterChart({ dates, lines, height = 240 }: { dates: string[]; lines: UwLine[]; height?: number }) {
  const W = 1000, H = height, padL = 6, padR = 48, padT = 12, padB = 20;
  const N = Math.max(0, ...lines.map(l => l.uw.length));
  if (N < 2) return <div className="qc-state">Недостаточно данных.</div>;
  const allVals = lines.flatMap(l => l.uw).filter(v => isFinite(v));
  const lo = Math.min(0, ...allVals);
  const stride = Math.max(1, Math.ceil(N / 800));
  const idx: number[] = [];
  for (let i = 0; i < N; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== N - 1) idx.push(N - 1);

  const xAt = (k: number) => padL + (W - padL - padR) * (idx.length <= 1 ? 0 : k / (idx.length - 1));
  const yAt = (v: number) => { const t = lo < 0 && isFinite(v) ? v / lo : 0; return padT + (H - padT - padB) * Math.max(0, Math.min(1, t)); };

  const levels: number[] = [];
  const step = Math.abs(lo) > 0.4 ? 0.2 : 0.1;
  for (let g = 0; g >= lo - 1e-9; g -= step) levels.push(g);
  const xTicks: { pos: number; text: string }[] = [];
  let last = '';
  idx.forEach((o, k) => { const y = dates[Math.min(o, dates.length - 1)]?.slice(0, 4); if (y && y !== last) { xTicks.push({ pos: k, text: y }); last = y; } });

  const pathFor = (uw: number[]) => {
    const pts = idx.map((o, k) => `${xAt(k).toFixed(1)},${yAt(isFinite(uw[o]) ? uw[o] : 0).toFixed(1)}`);
    return { line: `M${pts.join(' L')}`, area: `M${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} L${pts.join(' L')} L${xAt(idx.length - 1).toFixed(1)},${yAt(0).toFixed(1)} Z` };
  };

  return (
    <svg className="qc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {levels.map((g, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yAt(g)} y2={yAt(g)} stroke="var(--qc-line)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          <text x={W - padR + 4} y={yAt(g) + 3} className="qc-chart-lbl">{fmtPct0(g)}</text>
        </g>
      ))}
      {xTicks.map((t, i) => <text key={i} x={xAt(t.pos)} y={H - 6} className="qc-chart-xt" textAnchor="middle">{t.text}</text>)}
      {lines.map((l, i) => {
        const p = pathFor(l.uw);
        return (
          <g key={i}>
            {l.fill && <path d={p.area} fill={l.color} opacity={0.14} />}
            <path d={p.line} fill="none" stroke={l.color} strokeWidth={1.6} strokeDasharray={l.dash ? '5 4' : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
}
