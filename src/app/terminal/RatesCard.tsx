'use client';

import { useEffect, useState } from 'react';
import { Badge, Skeleton } from '@/components/ui';
import type { RatesData } from '@/lib/terminal/rates';

export default function RatesCard() {
  const [data, setData] = useState<RatesData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/market/rates')
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
          <span className="text-[13px] font-bold text-ink">Кривая доходности · ставки</span>
          <Badge variant="brand">UST</Badge>
        </div>
        {data && <span className="text-[11px] text-ink-3">{data.asOf}</span>}
      </div>
      <div className="p-3.5">
        {err ? (
          <div className="px-2 py-10 text-center text-[12px] text-ink-3">Не удалось загрузить ставки</div>
        ) : !data ? (
          <Skeleton className="h-[260px] w-full rounded-fk" />
        ) : (
          <RatesBody d={data} />
        )}
        {data?.synthetic && <div className="mt-2 text-[11px] text-warn-strong">демо-данные (нет ключей) — не рыночная картина</div>}
      </div>
    </div>
  );
}

function Tile({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'up' | 'down' | 'warn' }) {
  const cls = tone === 'up' ? 'text-up-strong' : tone === 'down' ? 'text-down-strong' : tone === 'warn' ? 'text-warn-strong' : 'text-ink';
  return (
    <div className="rounded-fk-sm border border-line bg-surface px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{k}</div>
      <div className={`mt-0.5 text-[16px] font-extrabold tabular-nums ${cls}`}>{v}</div>
      {sub && <div className="text-[11px] tabular-nums text-ink-3">{sub}</div>}
    </div>
  );
}

const bp = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v} бп`);

function RatesBody({ d }: { d: RatesData }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile k="10Y UST" v={d.tenY != null ? d.tenY.toFixed(2) + '%' : '—'} sub={bp(d.tenYChg) + ' д/д'} tone={d.tenYChg != null && d.tenYChg < 0 ? 'down' : undefined} />
        <Tile k="10Y−2Y" v={d.spread10_2 != null ? `${d.spread10_2 > 0 ? '+' : ''}${d.spread10_2} бп` : '—'} sub={d.spread10_2 != null && d.spread10_2 < 0 ? 'инверсия' : 'норм.'} tone={d.spread10_2 != null && d.spread10_2 < 0 ? 'warn' : 'up'} />
        <Tile k="10Y−3M" v={d.spread10_3m != null ? `${d.spread10_3m > 0 ? '+' : ''}${d.spread10_3m} бп` : '—'} tone={d.spread10_3m != null && d.spread10_3m < 0 ? 'warn' : 'up'} />
        {d.dxy ? (
          <Tile k="DXY (UUP)" v={d.dxy.last != null ? d.dxy.last.toFixed(1) : '—'} sub={d.dxy.chg21 != null ? `${d.dxy.chg21 > 0 ? '+' : ''}${d.dxy.chg21.toFixed(1)}% 21д` : undefined} />
        ) : (
          <Tile k="HY 21д*" v={d.hy21 != null ? `${d.hy21 > 0 ? '+' : ''}${d.hy21.toFixed(1)}%` : '—'} tone={d.hy21 != null && d.hy21 < 0 ? 'down' : undefined} />
        )}
      </div>
      <CurveChart curve={d.curve} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: '#6d5bf0' }} />сегодня</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: '#c7cfdd' }} />~месяц назад</span>
        <span className="text-ink-3">инверсия 10Y−2Y — поздний цикл; HY 21д&lt;0 — спреды расширяются</span>
      </div>
    </div>
  );
}

function CurveChart({ curve }: { curve: RatesData['curve'] }) {
  const W = 560;
  const H = 200;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const vals = curve.flatMap((c) => [c.today, c.prior]).filter((v): v is number => v != null);
  if (vals.length < 2) return <div className="py-8 text-center text-[12px] text-ink-3">Нет данных кривой</div>;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.18 || 0.2;
  lo -= pad;
  hi += pad;
  const n = curve.length;
  const X = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const Y = (v: number) => padT + (H - padT - padB) - ((v - lo) / (hi - lo)) * (H - padT - padB);
  const line = (key: 'today' | 'prior') => {
    const pts = curve.map((c, i) => ({ i, v: c[key] })).filter((p) => p.v != null) as { i: number; v: number }[];
    return pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  };
  // y-сетка: 3 линии
  const ticks = [lo + (hi - lo) * 0.2, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.8];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" style={{ maxHeight: 220 }} fontFamily="inherit">
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={Y(t).toFixed(1)} y2={Y(t).toFixed(1)} stroke="#eef1f6" />
          <text x={4} y={(Y(t) + 3).toFixed(1)} fontSize="9.5" fill="#8b95a7">{t.toFixed(1)}</text>
        </g>
      ))}
      {curve.map((c, i) => (
        <text key={c.label} x={X(i).toFixed(1)} y={H - 8} fontSize="9.5" fill="#8b95a7" textAnchor="middle">{c.label}</text>
      ))}
      <path d={line('prior')} fill="none" stroke="#c7cfdd" strokeWidth={2} strokeDasharray="5 4" />
      <path d={line('today')} fill="none" stroke="#6d5bf0" strokeWidth={2.6} strokeLinejoin="round" />
      {curve.map((c, i) => (c.today != null ? <circle key={c.label} cx={X(i).toFixed(1)} cy={Y(c.today).toFixed(1)} r={3} fill="#6d5bf0" /> : null))}
    </svg>
  );
}
