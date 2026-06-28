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
  // независимый автоскейл по каждой оси (иначе один выброс сжимает остальные в кучу),
  // линия 100 всегда внутри домена как точка отсчёта
  const xsAll = items.flatMap((it) => it.tail.map((p) => p.x));
  const ysAll = items.flatMap((it) => it.tail.map((p) => p.y));
  const fit = (vals: number[]) => {
    let lo = Math.min(...vals, 100);
    let hi = Math.max(...vals, 100);
    const p = (hi - lo) * 0.12 || 1;
    lo -= p;
    hi += p;
    return [lo, hi] as const;
  };
  const [xlo, xhi] = fit(xsAll);
  const [ylo, yhi] = fit(ysAll);
  const X = (v: number) => pad + ((v - xlo) / (xhi - xlo)) * (S - 2 * pad);
  const Y = (v: number) => pad + (S - 2 * pad) - ((v - ylo) / (yhi - ylo)) * (S - 2 * pad);
  const cx = X(100);
  const cy = Y(100);
  // подписи с разведением по вертикали (анти-наложение), при сдвиге — тонкий лидер
  const labels = items
    .map((it) => ({ sym: it.symbol, col: QC[it.quadrant].c, dx: X(it.tail[it.tail.length - 1].x), dy: Y(it.tail[it.tail.length - 1].y) }))
    .sort((a, b) => a.dy - b.dy);
  let prevY = -Infinity;
  for (const l of labels) {
    let ly = l.dy;
    if (ly - prevY < 12) ly = prevY + 12;
    (l as any).ly = Math.min(S - 4, ly);
    prevY = (l as any).ly;
  }
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
        {/* хвосты + точки */}
        {items.map((it) => {
          const col = QC[it.quadrant].c;
          const path = it.tail.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
          const cur = it.tail[it.tail.length - 1];
          return (
            <g key={it.symbol}>
              <path d={path} fill="none" stroke={col} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" opacity={0.32} />
              <circle cx={X(cur.x).toFixed(1)} cy={Y(cur.y).toFixed(1)} r={5} fill={col} stroke="#fff" strokeWidth={1.5} />
            </g>
          );
        })}
        {/* подписи с разведением (лидер-линия при сдвиге) */}
        {labels.map((l) => {
          const ly = (l as any).ly as number;
          const lx = Math.min(S - pad - 2, l.dx + 8);
          return (
            <g key={l.sym}>
              {Math.abs(ly - l.dy) > 4 && <line x1={(l.dx + 5).toFixed(1)} y1={l.dy.toFixed(1)} x2={lx.toFixed(1)} y2={(ly - 3).toFixed(1)} stroke={l.col} strokeWidth={0.7} opacity={0.5} />}
              <text x={lx.toFixed(1)} y={ly.toFixed(1)} fontSize="10" fontWeight="700" fill="#0f1729" stroke="#fff" strokeWidth={2.6} paintOrder="stroke" strokeLinejoin="round">{l.sym}</text>
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
