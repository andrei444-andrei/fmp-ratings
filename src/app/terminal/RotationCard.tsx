'use client';

import { useEffect, useRef, useState } from 'react';
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
  const MAXLEN = Math.max(2, ...items.map((it) => it.tail.length));
  const [step, setStep] = useState(MAXLEN - 1); // индекс точки хвоста, которую сейчас показываем
  const [playing, setPlaying] = useState(false);
  const [hov, setHov] = useState<string | null>(null);
  const [hovStep, setHovStep] = useState<number | null>(null); // проигрывание движения одной точки на ховере
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hovTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // наведение на точку → её дот «проезжает» свой хвост (показываем движение сектора)
  const startHover = (sym: string) => {
    setHov(sym);
    if (playing) return;
    if (hovTimer.current) clearInterval(hovTimer.current);
    const len = items.find((i) => i.symbol === sym)?.tail.length ?? MAXLEN;
    setHovStep(0);
    let s = 0;
    hovTimer.current = setInterval(() => {
      s += 1;
      setHovStep(s);
      if (s >= len - 1) {
        if (hovTimer.current) clearInterval(hovTimer.current);
        hovTimer.current = null;
      }
    }, 300);
  };
  const endHover = () => {
    setHov(null);
    setHovStep(null);
    if (hovTimer.current) clearInterval(hovTimer.current);
    hovTimer.current = null;
  };

  const play = () => {
    if (timer.current) clearInterval(timer.current);
    setPlaying(true);
    setStep(0);
    let s = 0;
    timer.current = setInterval(() => {
      s += 1;
      setStep(s);
      if (s >= MAXLEN - 1) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setPlaying(false);
      }
    }, 360);
  };
  // интро-проигрывание один раз при загрузке данных
  useEffect(() => {
    play();
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (hovTimer.current) clearInterval(hovTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (!items.length) return <div className="px-2 py-10 text-center text-[12px] text-ink-3">Нет данных</div>;

  const S = 360;
  const pad = 22;
  // независимый автоскейл по осям (выброс не сжимает кластер), 100 всегда внутри домена
  const xsAll = items.flatMap((it) => it.tail.map((p) => p.x));
  const ysAll = items.flatMap((it) => it.tail.map((p) => p.y));
  const fit = (vals: number[]) => {
    let lo = Math.min(...vals, 100);
    let hi = Math.max(...vals, 100);
    const p = (hi - lo) * 0.12 || 1;
    return [lo - p, hi + p] as const;
  };
  const [xlo, xhi] = fit(xsAll);
  const [ylo, yhi] = fit(ysAll);
  const X = (v: number) => pad + ((v - xlo) / (xhi - xlo)) * (S - 2 * pad);
  const Y = (v: number) => pad + (S - 2 * pad) - ((v - ylo) / (yhi - ylo)) * (S - 2 * pad);
  const cx = X(100);
  const cy = Y(100);

  // позиция точки: общий проигрыш → step; ховер конкретной → её hovStep; иначе финал
  const posAt = (it: RotationItem) => {
    if (playing) return it.tail[Math.min(step, it.tail.length - 1)];
    if (hov === it.symbol && hovStep != null) return it.tail[Math.min(hovStep, it.tail.length - 1)];
    return it.tail[it.tail.length - 1];
  };

  // подписи — у финального положения, разведены по вертикали (анти-наложение)
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

  const hovItem = hov ? items.find((it) => it.symbol === hov) ?? null : null;

  const ranked = [...items].sort((a, b) => b.rsRatio - a.rsRatio);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-3">{playing ? 'проигрываю ротацию…' : 'наведи на строку/точку · ▶ повтор'}</span>
        <button
          type="button"
          onClick={play}
          disabled={playing}
          className="rounded-fk-sm border border-line-strong px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:border-brand-100 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
        >
          ▶ проиграть
        </button>
      </div>
      {/* плотная компоновка: график + рейтинг-таблица заполняют ширину */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_188px]">
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" className="block self-start" style={{ maxHeight: 340 }} fontFamily="inherit">
        {/* quadrant fills */}
        <rect x={cx} y={pad} width={S - pad - cx} height={cy - pad} fill="#12b981" opacity="0.06" />
        <rect x={cx} y={cy} width={S - pad - cx} height={S - pad - cy} fill="#f59e0b" opacity="0.06" />
        <rect x={pad} y={cy} width={cx - pad} height={S - pad - cy} fill="#f43f5e" opacity="0.06" />
        <rect x={pad} y={pad} width={cx - pad} height={cy - pad} fill="#6d5bf0" opacity="0.06" />
        <line x1={cx} y1={pad} x2={cx} y2={S - pad} stroke="#c7cfdd" />
        <line x1={pad} y1={cy} x2={S - pad} y2={cy} stroke="#c7cfdd" />
        <text x={S - pad - 4} y={pad + 12} textAnchor="end" fontSize="9.5" fontWeight="700" fill="#12b981">ЛИДЕРЫ</text>
        <text x={S - pad - 4} y={S - pad - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="#f59e0b">СЛАБЕЮТ</text>
        <text x={pad + 4} y={S - pad - 5} fontSize="9.5" fontWeight="700" fill="#f43f5e">ОТСТАЮТ</text>
        <text x={pad + 4} y={pad + 12} fontSize="9.5" fontWeight="700" fill="#6d5bf0">УЛУЧШАЮТСЯ</text>

        {/* хвосты-траектории (на ховере фокус) */}
        {items.map((it) => {
          const focused = hov === it.symbol;
          const dim = hov && !focused;
          const path = it.tail.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
          return (
            <path
              key={it.symbol}
              d={path}
              fill="none"
              stroke={QC[it.quadrant].c}
              strokeWidth={focused ? 2.4 : 1.3}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={dim ? 0.07 : focused ? 0.75 : 0.3}
              style={{ transition: 'opacity .2s, stroke-width .2s' }}
            />
          );
        })}

        {/* точки — едут по хвосту при проигрывании (transform-transition) */}
        {items.map((it) => {
          const p = posAt(it);
          const col = QC[it.quadrant].c;
          const focused = hov === it.symbol;
          const dim = hov && !focused;
          return (
            <g
              key={it.symbol}
              style={{ transform: `translate(${X(p.x).toFixed(1)}px, ${Y(p.y).toFixed(1)}px)`, transition: 'transform .3s ease', opacity: dim ? 0.25 : 1, cursor: 'pointer' }}
              onMouseEnter={() => startHover(it.symbol)}
              onMouseLeave={endHover}
            >
              <circle r={14} fill="transparent" />
              <circle r={focused ? 7 : 5} fill={col} stroke="#fff" strokeWidth={1.6} style={{ transition: 'r .15s' }} />
            </g>
          );
        })}

        {/* подписи у финальных позиций (скрываем во время проигрывания) */}
        {!playing &&
          labels.map((l) => {
            const ly = (l as any).ly as number;
            const lx = Math.min(S - pad - 2, l.dx + 8);
            const dim = hov && hov !== l.sym;
            return (
              <g key={l.sym} opacity={dim ? 0.3 : 1} style={{ transition: 'opacity .2s' }}>
                {Math.abs(ly - l.dy) > 4 && <line x1={(l.dx + 5).toFixed(1)} y1={l.dy.toFixed(1)} x2={lx.toFixed(1)} y2={(ly - 3).toFixed(1)} stroke={l.col} strokeWidth={0.7} opacity={0.5} />}
                <text x={lx.toFixed(1)} y={ly.toFixed(1)} fontSize="10" fontWeight="700" fill="#0f1729" stroke="#fff" strokeWidth={2.6} paintOrder="stroke" strokeLinejoin="round">{l.sym}</text>
              </g>
            );
          })}

        {/* тултип наведения */}
        {hovItem && (() => {
          const p = posAt(hovItem);
          const tx = Math.min(S - 122, X(p.x) + 10);
          const ty = Math.max(6, Y(p.y) - 46);
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={116} height={42} rx={6} fill="#fff" stroke="#e8ebf2" />
              <text x={tx + 8} y={ty + 15} fontSize="11" fontWeight="800" fill="#0f1729">{hovItem.symbol} <tspan fontWeight="600" fill={QC[hovItem.quadrant].c}>{QC[hovItem.quadrant].label}</tspan></text>
              <text x={tx + 8} y={ty + 29} fontSize="10" fill="#46506a">RS {hovItem.rsRatio.toFixed(1)} · Mom {hovItem.rsMomentum.toFixed(1)}</text>
              <text x={tx + 8} y={ty + 39} fontSize="9.5" fill="#8b95a7">{hovItem.title}</text>
            </g>
          );
        })()}
        <text x={S - pad} y={S - 6} textAnchor="end" fontSize="9" fill="#8b95a7">RS-Ratio →</text>
      </svg>

      {/* рейтинг-таблица справа — заполняет пространство данными, синхронизирована с графиком */}
      <div className="overflow-hidden rounded-fk-sm border border-line text-[11.5px] self-start">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 bg-surface-2 px-2 py-1 text-[9px] uppercase tracking-wide text-ink-3">
          <span>сектор</span><span className="text-right">RS</span><span className="text-right">mom</span>
        </div>
        {ranked.map((it) => {
          const on = hov === it.symbol;
          const momUp = it.rsMomentum >= 100;
          return (
            <div
              key={it.symbol}
              onMouseEnter={() => startHover(it.symbol)}
              onMouseLeave={endHover}
              className={`grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-x-2 border-t border-line px-2 py-[3px] ${on ? 'bg-brand-50' : 'hover:bg-surface-2'}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: QC[it.quadrant].c }} />
                <b className="text-ink">{it.symbol}</b>
              </span>
              <span className="text-right tabular-nums">{it.rsRatio.toFixed(1)}</span>
              <span className={`text-right tabular-nums ${momUp ? 'text-up-strong' : 'text-down-strong'}`}>{momUp ? '▲' : '▼'}{Math.abs(it.rsMomentum - 100).toFixed(1)}</span>
            </div>
          );
        })}
      </div>
      </div>
      <details className="text-[11px] text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink-2">ℹ как считается</summary>
        <div className="mt-1.5 space-y-1 leading-relaxed">
          <div><b className="text-ink-2">RS</b> = цена сектора / SPY (относительная сила).</div>
          <div><b className="text-ink-2">RS-Ratio (X)</b> = 100·RS / среднее(RS). &gt;100 — сектор сильнее рынка, &lt;100 — слабее.</div>
          <div><b className="text-ink-2">RS-Momentum (Y)</b> = ускорение RS-Ratio. &gt;100 — сила растёт, &lt;100 — затухает.</div>
          <div>Ряды сглажены EMA. Точки «проигрывают» траекторию ~6 недель. Движение по часовой: Улучшаются → Лидеры → Слабеют → Отстают.</div>
        </div>
      </details>
    </div>
  );
}
