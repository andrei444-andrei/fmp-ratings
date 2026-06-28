'use client';

import { useEffect, useState } from 'react';
import { Badge, Skeleton } from '@/components/ui';
import type { RotationData, RotationItem } from '@/lib/terminal/rotation';

const QC: Record<RotationItem['quadrant'], { c: string; label: string }> = {
  leading: { c: '#12b981', label: 'Лидеры' },
  weakening: { c: '#f59e0b', label: 'Слабеют' },
  lagging: { c: '#f43f5e', label: 'Отстают' },
  improving: { c: '#6d5bf0', label: 'Улучшаются' },
};

export default function RotationCard() {
  const [data, setData] = useState<RotationData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/market/rotation')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => alive && setData(d))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink">Ротация секторов · RRG</span>
          <Badge variant="brand">vs {data?.benchmark ?? 'SPY'}</Badge>
        </div>
        {data && <span className="text-[11px] text-ink-3">RS-Ratio × Momentum</span>}
      </div>
      <div className="p-3.5">
        {err ? (
          <div className="px-2 py-10 text-center text-[12px] text-ink-3">Не удалось загрузить ротацию</div>
        ) : !data ? (
          <Skeleton className="h-[320px] w-full rounded-fk" />
        ) : (
          <RRGChart items={data.items} />
        )}
        {data?.synthetic && <div className="mt-2 text-[11px] text-warn-strong">демо-данные (нет ключей) — не рыночная картина</div>}
      </div>
    </div>
  );
}

function RRGChart({ items }: { items: RotationItem[] }) {
  if (!items.length) return <div className="px-2 py-10 text-center text-[12px] text-ink-3">Нет данных</div>;
  const S = 360;
  const pad = 30;
  // домен симметрично вокруг 100
  let span = 1;
  for (const it of items) for (const p of it.tail) span = Math.max(span, Math.abs(p.x - 100), Math.abs(p.y - 100));
  span *= 1.18;
  const lo = 100 - span;
  const hi = 100 + span;
  const X = (v: number) => pad + ((v - lo) / (hi - lo)) * (S - 2 * pad);
  const Y = (v: number) => pad + (S - 2 * pad) - ((v - lo) / (hi - lo)) * (S - 2 * pad);
  const mid = (100 - lo) / (hi - lo);
  const cx = pad + mid * (S - 2 * pad);
  const cy = pad + (S - 2 * pad) - mid * (S - 2 * pad);
  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" className="block" style={{ maxHeight: 380 }} fontFamily="inherit">
        {/* quadrant fills */}
        <rect x={cx} y={pad} width={S - pad - cx} height={cy - pad} fill="#12b981" opacity="0.06" />
        <rect x={cx} y={cy} width={S - pad - cx} height={S - pad - cy} fill="#f59e0b" opacity="0.06" />
        <rect x={pad} y={cy} width={cx - pad} height={S - pad - cy} fill="#f43f5e" opacity="0.06" />
        <rect x={pad} y={pad} width={cx - pad} height={cy - pad} fill="#6d5bf0" opacity="0.06" />
        {/* axes at 100 */}
        <line x1={cx} y1={pad} x2={cx} y2={S - pad} stroke="#c7cfdd" />
        <line x1={pad} y1={cy} x2={S - pad} y2={cy} stroke="#c7cfdd" />
        {/* quadrant labels */}
        <text x={S - pad - 4} y={pad + 12} textAnchor="end" fontSize="9.5" fontWeight="700" fill="#12b981">ЛИДЕРЫ</text>
        <text x={S - pad - 4} y={S - pad - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="#f59e0b">СЛАБЕЮТ</text>
        <text x={pad + 4} y={S - pad - 5} fontSize="9.5" fontWeight="700" fill="#f43f5e">ОТСТАЮТ</text>
        <text x={pad + 4} y={pad + 12} fontSize="9.5" fontWeight="700" fill="#6d5bf0">УЛУЧШАЮТСЯ</text>
        {/* items: гладкий хвост + точка + подпись с белым ореолом */}
        {items.map((it) => {
          const col = QC[it.quadrant].c;
          const path = it.tail.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
          const cur = it.tail[it.tail.length - 1];
          return (
            <g key={it.symbol}>
              <path d={path} fill="none" stroke={col} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" opacity={0.35} />
              <circle cx={X(cur.x).toFixed(1)} cy={Y(cur.y).toFixed(1)} r={5} fill={col} stroke="#fff" strokeWidth={1.5} />
              <text x={(X(cur.x) + 8).toFixed(1)} y={(Y(cur.y) + 3.5).toFixed(1)} fontSize="10" fontWeight="700" fill="#0f1729" stroke="#fff" strokeWidth={2.6} paintOrder="stroke" strokeLinejoin="round">{it.symbol}</text>
            </g>
          );
        })}
        <text x={S - pad} y={S - 6} textAnchor="end" fontSize="9" fill="#8b95a7">RS-Ratio →</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {(['leading', 'improving', 'weakening', 'lagging'] as const).map((q) => (
          <span key={q} className="inline-flex items-center gap-1.5 text-ink-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: QC[q].c }} />
            {QC[q].label}
            <span className="text-ink-3">{items.filter((i) => i.quadrant === q).map((i) => i.symbol).join(' ') || '—'}</span>
          </span>
        ))}
      </div>
      <details className="text-[11px] text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink-2">ℹ как считается</summary>
        <div className="mt-1.5 space-y-1 leading-relaxed">
          <div><b className="text-ink-2">RS</b> = цена сектора / SPY (относительная сила).</div>
          <div><b className="text-ink-2">RS-Ratio (X)</b> = 100·RS / среднее(RS). &gt;100 — сектор сильнее рынка, &lt;100 — слабее.</div>
          <div><b className="text-ink-2">RS-Momentum (Y)</b> = ускорение RS-Ratio. &gt;100 — сила растёт, &lt;100 — затухает.</div>
          <div>Ряды сглажены EMA. Хвост — траектория ~6 недель. Движение по часовой: Улучшаются → Лидеры → Слабеют → Отстают.</div>
        </div>
      </details>
    </div>
  );
}
