'use client';

import { useEffect, useState } from 'react';
import { Badge, Skeleton } from '@/components/ui';
import type { RiskData } from '@/lib/terminal/risk';

const REGIME_TONE: Record<RiskData['regime'], string> = { 'спокойно': '#12b981', 'настороже': '#f59e0b', 'стресс': '#f43f5e' };

export default function RiskCard() {
  const [data, setData] = useState<RiskData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/market/risk')
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
          <span className="text-[13px] font-bold text-ink">Волатильность · риск-режим</span>
          {data && <span className="text-[11px] font-semibold" style={{ color: REGIME_TONE[data.regime] }}>{data.regime}</span>}
        </div>
        {data && <span className="text-[11px] text-ink-3">{data.asOf}</span>}
      </div>
      <div className="p-3.5">
        {err ? (
          <div className="px-2 py-10 text-center text-[12px] text-ink-3">Не удалось загрузить риск</div>
        ) : !data ? (
          <Skeleton className="h-[220px] w-full rounded-fk" />
        ) : (
          <RiskBody d={data} />
        )}
        {data?.synthetic && <div className="mt-2 text-[11px] text-warn-strong">демо-данные (нет ключей) — не рыночная картина</div>}
      </div>
    </div>
  );
}

function Tile({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-fk-sm border border-line bg-surface px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{k}</div>
      <div className="mt-0.5 text-[16px] font-extrabold tabular-nums" style={tone ? { color: tone } : undefined}>{v}</div>
      {sub && <div className="text-[11px] tabular-nums text-ink-3">{sub}</div>}
    </div>
  );
}

function RiskBody({ d }: { d: RiskData }) {
  const term = d.termRatio == null ? null : d.termRatio > 1 ? 'бэквардация' : 'контанго';
  const premium = d.vix != null && d.realized21 != null ? +(d.vix - d.realized21).toFixed(1) : null;
  const volRatio = d.realized21 != null && d.realized63 != null && d.realized63 > 0 ? d.realized21 / d.realized63 : null;
  const hasVix = d.vix != null;
  // плитки без «мёртвых» состояний: при наличии VIX — VIX-центрично, иначе — по реализованной воле
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {hasVix ? (
          <>
            <Tile k="VIX (impl.)" v={d.vix!.toFixed(1)} sub={d.vixChg != null ? `${d.vixChg > 0 ? '+' : ''}${d.vixChg} д/д` : 'implied vol'} tone={REGIME_TONE[d.regime]} />
            {term ? (
              <Tile k="Терм-структура" v={term} sub={`VIX/VIX3M ${d.termRatio!.toFixed(2)}`} tone={term === 'бэквардация' ? '#f43f5e' : '#12b981'} />
            ) : (
              <Tile k="Премия impl−real" v={premium != null ? `${premium > 0 ? '+' : ''}${premium}` : '—'} sub="VIX − реализ. 21д" tone={premium != null && premium < 0 ? '#f43f5e' : undefined} />
            )}
            <Tile k="Реализ. вол" v={d.realized21 != null ? d.realized21.toFixed(0) : '—'} sub={d.realized63 != null ? `21д · 63д ${d.realized63.toFixed(0)}` : '21д'} />
          </>
        ) : (
          <>
            <Tile k="Реализ. вол 21д" v={d.realized21 != null ? d.realized21.toFixed(1) : '—'} sub="годовая, из SPY" tone={REGIME_TONE[d.regime]} />
            <Tile k="Реализ. вол 63д" v={d.realized63 != null ? d.realized63.toFixed(1) : '—'} sub="трёхмесячная база" />
            <Tile k="Вол-тренд 21/63" v={volRatio != null ? `×${volRatio.toFixed(2)}` : '—'} sub={volRatio != null ? (volRatio > 1.1 ? 'ускоряется' : volRatio < 0.9 ? 'затухает' : 'стабильно') : ''} tone={volRatio != null && volRatio > 1.1 ? '#f43f5e' : volRatio != null && volRatio < 0.9 ? '#12b981' : undefined} />
          </>
        )}
        <Tile k="SPX от ATH" v={d.drawdown != null ? `${d.drawdown > 0 ? '+' : ''}${d.drawdown.toFixed(1)}%` : '—'} tone={d.drawdown != null && d.drawdown < -5 ? '#f43f5e' : undefined} />
      </div>
      <VolChart hist={d.hist} vix={d.vix} />
      <div className="text-[11px] text-ink-3">{hasVix ? 'VIX — подразумеваемая вол; линия — реализованная (21д). Бэквардация VIX и рост реализованной — маркеры стресса.' : 'линия — реализованная вол SPY (21д, годовая). Рост реализованной и ускорение 21/63 — маркеры стресса.'}</div>
    </div>
  );
}

function VolChart({ hist, vix }: { hist: RiskData['hist']; vix: number | null }) {
  const W = 560;
  const H = 150;
  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  if (!hist || hist.length < 2) return <div className="py-8 text-center text-[12px] text-ink-3">Нет данных волатильности</div>;
  const vals = hist.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || 1;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const n = hist.length;
  const X = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const Y = (v: number) => padT + (H - padT - padB) - ((v - lo) / (hi - lo)) * (H - padT - padB);
  const last = vals[vals.length - 1];
  const up = last >= vals[0];
  const color = up ? '#f43f5e' : '#12b981'; // рост вола = тревожнее
  const line = hist.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(n - 1).toFixed(1)} ${H - padB} L${X(0).toFixed(1)} ${H - padB} Z`;
  const ticks = [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75];
  const mon = (dd: string) => {
    const t = new Date(dd + 'T00:00:00');
    return isNaN(t.getTime()) ? '' : t.toLocaleDateString('ru-RU', { month: 'short' });
  };
  const tk = Math.min(6, n);
  const xt: number[] = [];
  for (let i = 0; i < tk; i++) xt.push(Math.round((i / (tk - 1)) * (n - 1)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" style={{ maxHeight: 170 }} fontFamily="inherit">
      <defs>
        <linearGradient id="volg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={Y(t).toFixed(1)} y2={Y(t).toFixed(1)} stroke="#eef1f6" />
          <text x={4} y={(Y(t) + 3).toFixed(1)} fontSize="9" fill="#8b95a7">{t.toFixed(0)}</text>
        </g>
      ))}
      {xt.map((i, k) => (
        <text key={k} x={X(i).toFixed(1)} y={H - 6} fontSize="9" fill="#8b95a7" textAnchor="middle">{mon(hist[i].date)}</text>
      ))}
      <path d={area} fill="url(#volg)" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={X(n - 1).toFixed(1)} cy={Y(last).toFixed(1)} r={3} fill={color} />
      <text x={X(n - 1).toFixed(1)} y={(Y(last) - 6).toFixed(1)} fontSize="9.5" fontWeight="700" fill={color} textAnchor="end">{last.toFixed(0)}</text>
    </svg>
  );
}
