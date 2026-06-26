'use client';

import { useEffect, useMemo, useState } from 'react';
import { Delta, Sparkline, SegmentedControl, Badge, Skeleton } from '@/components/ui';
import type { InstrumentMetrics, MarketOverview, OverviewBlock } from '@/lib/terminal/types';

const PCOLS: { key: number | 'ytd'; label: string }[] = [
  { key: 1, label: '1D' },
  { key: 5, label: '5D' },
  { key: 21, label: '21D' },
  { key: 63, label: '63D' },
  { key: 'ytd', label: 'YTD' },
];

type Mode = 'abs' | 'excess';

function num(m: InstrumentMetrics | null, key: number | 'ytd'): number | null {
  if (!m) return null;
  return key === 'ytd' ? m.ytd : m.returns[key] ?? null;
}

function Pct({ v, dim }: { v: number | null; dim?: boolean }) {
  if (v == null) return <span className="text-ink-3">—</span>;
  if (dim && Math.abs(v) < 0.05) return <span className="text-ink-3 tabular-nums">0.0</span>;
  return <Delta value={v} percent={false} decimals={1} showArrow={false} size="sm" />;
}

function RangeBar({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative h-[7px] w-[54px] overflow-hidden rounded-fk-pill bg-surface-2">
        <i className="absolute inset-y-0 left-0 rounded-fk-pill" style={{ width: `${Math.max(2, Math.min(100, v))}%`, background: 'linear-gradient(90deg,#cdd6e6,var(--fk-brand))' }} />
      </span>
      <span className="w-7 text-right text-[11px] tabular-nums text-ink-2">{Math.round(v)}%</span>
    </span>
  );
}

function flags(m: InstrumentMetrics | null) {
  if (!m) return null;
  return (
    <>
      {m.z63 != null && Math.abs(m.z63) > 2 && <span className="ml-1 text-warn-strong" title="аномалия |z|>2">⚡</span>}
      {m.volRatio != null && m.volRatio > 1.5 && <span className="ml-1 font-extrabold text-down-strong" title="vol_ratio>1.5">!</span>}
    </>
  );
}

export default function TerminalPage() {
  const [data, setData] = useState<MarketOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('abs');
  const [sel, setSel] = useState<{ block: OverviewBlock; m: InstrumentMetrics; title: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/market/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message || 'ошибка загрузки'));
    return () => {
      alive = false;
    };
  }, []);

  // SPY-метрики (бенч для относительной силы и режима «Превышение SPY»)
  const spy = useMemo(() => {
    if (!data) return null;
    for (const b of data.blocks) for (const c of b.instruments) if (c.def.symbol === 'SPY') return c.metrics;
    return null;
  }, [data]);

  const spyRet = (key: number | 'ytd') => num(spy, key);
  const cell = (m: InstrumentMetrics | null, key: number | 'ytd') => {
    const v = num(m, key);
    if (v == null) return null;
    if (mode === 'excess') {
      const b = spyRet(key);
      return b == null ? null : v - b;
    }
    return v;
  };

  // Лидеры / аутсайдеры / аномалии дня по всей вселенной
  const movers = useMemo(() => {
    if (!data) return { up: [], down: [], anom: [] as { sym: string; z: number; vr: number | null }[] };
    const all: { sym: string; m: InstrumentMetrics }[] = [];
    const seen = new Set<string>();
    for (const b of data.blocks)
      for (const c of b.instruments) if (c.metrics && !seen.has(c.def.symbol)) {
        seen.add(c.def.symbol);
        all.push({ sym: c.def.symbol, m: c.metrics });
      }
    const byR1 = all.filter((x) => x.m.returns[1] != null).sort((a, b) => (b.m.returns[1]! - a.m.returns[1]!));
    const anom = all
      .filter((x) => x.m.z63 != null)
      .map((x) => ({ sym: x.sym, z: x.m.z63!, vr: x.m.volRatio }))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 4);
    return { up: byR1.slice(0, 4), down: byR1.slice(-4).reverse(), anom };
  }, [data]);

  if (err)
    return (
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="rounded-fk border border-down bg-down-soft p-4 text-down-strong">Не удалось загрузить обзор: {err}</div>
      </div>
    );

  return (
    <div className="mx-auto max-w-[1320px] px-5 pb-24 pt-5">
      {/* Шапка */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-ink">Рыночный терминал</h1>
          {data && <span className="text-xs text-ink-3">обновлено {data.asOf} · EOD</span>}
          {data?.synthetic && <Badge variant="warn">демо-данные · не рыночная картина</Badge>}
        </div>
        <SegmentedControl<Mode>
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { label: 'Абсолют %', value: 'abs' },
            { label: 'Превышение SPY', value: 'excess' },
          ]}
        />
      </div>

      {!data ? (
        <LoadingState />
      ) : (
        <>
          <RegimePulse data={data} movers={movers} />
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            {data.blocks.map((b) => (
              <BlockCard key={b.def.id} block={b} mode={mode} cell={cell} spy={spy} onPick={(m, title) => setSel({ block: b, m, title })} />
            ))}
          </div>
        </>
      )}

      {sel && <DetailDrawer sel={sel} spy={spy} onClose={() => setSel(null)} />}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3.5">
      <Skeleton className="h-40 w-full rounded-fk" />
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-fk" />
        ))}
      </div>
    </div>
  );
}

function RegimePulse({ data, movers }: { data: MarketOverview; movers: { up: any[]; down: any[]; anom: any[] } }) {
  const r = data.regime;
  const knob = Math.max(2, Math.min(98, r.score));
  const Col = ({ title, color, children }: any) => (
    <div>
      <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color }}>{title}</div>
      {children}
    </div>
  );
  return (
    <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.05fr_2fr]">
      <div className="rounded-fk border border-line bg-surface-elev shadow-fk-sm">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Режим рынка</span>
          <span className="text-[11px] text-ink-3">{r.label === 'risk-on' ? 'risk-on' : r.label === 'risk-off' ? 'risk-off' : 'нейтрально'}</span>
        </div>
        <div className="px-4 py-3.5">
          <div className="relative h-3 rounded-fk-pill" style={{ background: 'linear-gradient(90deg,#12b981,#a7e0c7 30%,#f2e3a6 55%,#f6b8a0 75%,#f43f5e)' }}>
            <div className="absolute -top-1 h-5 w-5 rounded-fk-pill border-[3px] border-brand bg-white shadow-fk-sm" style={{ left: `${knob}%`, transform: 'translateX(-50%)' }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] font-semibold">
            <span className="text-up-strong">RISK-ON</span>
            <span className="text-down-strong">RISK-OFF</span>
          </div>
          <div className="mt-2.5 flex gap-4 text-[11.5px] text-ink-2">
            <span>avg-corr <b className="text-ink">{r.avgCorr != null ? r.avgCorr.toFixed(2) : '—'}</b></span>
            <span>breadth <b className="text-ink">{r.breadth != null ? Math.round(r.breadth) + '%' : '—'}</b> &gt;MA200</span>
          </div>
        </div>
      </div>
      <div className="rounded-fk border border-line bg-surface-elev shadow-fk-sm">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Движение дня</span>
          <span className="text-[11px] text-ink-3">по всей вселенной</span>
        </div>
        <div className="grid grid-cols-1 gap-3 px-4 py-3.5 sm:grid-cols-3">
          <Col title="▲ Лидеры дня" color="var(--fk-up-text)">
            {movers.up.map((x) => (
              <Row3 key={x.sym} sym={x.sym} v={x.m.returns[1]} spark={x.m.spark} />
            ))}
          </Col>
          <Col title="▼ Аутсайдеры" color="var(--fk-down-text)">
            {movers.down.map((x) => (
              <Row3 key={x.sym} sym={x.sym} v={x.m.returns[1]} spark={x.m.spark} />
            ))}
          </Col>
          <Col title="⚠ Аномалии vol/z" color="var(--fk-warn-text)">
            {movers.anom.map((x) => (
              <div key={x.sym} className="flex items-center justify-between py-1">
                <span className="w-11 text-[12px] font-semibold">{x.sym}</span>
                <span className="text-[11.5px] tabular-nums text-warn-strong">z{x.z > 0 ? '+' : ''}{x.z.toFixed(1)}{x.vr != null ? ` · vol×${x.vr.toFixed(1)}` : ''}</span>
              </div>
            ))}
          </Col>
        </div>
      </div>
    </div>
  );
}

function Row3({ sym, v, spark }: { sym: string; v: number | null; spark: number[] }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="w-11 text-[12px] font-semibold">{sym}</span>
      {v != null && <Delta value={v} decimals={1} size="sm" />}
      <Sparkline data={spark} width={40} height={14} strokeWidth={1.4} />
    </div>
  );
}

function BlockCard({
  block,
  mode,
  cell,
  spy,
  onPick,
}: {
  block: OverviewBlock;
  mode: Mode;
  cell: (m: InstrumentMetrics | null, key: number | 'ytd') => number | null;
  spy: InstrumentMetrics | null;
  onPick: (m: InstrumentMetrics, title: string) => void;
}) {
  const spy63 = spy?.returns[63] ?? null;
  const bm = block.metrics;
  const breadth =
    bm.breadthMA200 != null
      ? `${Math.round(bm.breadthMA200)}% >MA200 · ${bm.advancers}↑/${bm.decliners}↓`
      : `${bm.advancers}↑/${bm.decliners}↓`;
  return (
    <div className="rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink">{block.def.title}</span>
          {block.def.benchmark && <Badge variant="brand">бенч {block.def.benchmark}</Badge>}
        </div>
        <span className="text-[11px] text-ink-3">{breadth}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-ink-3">
              <th className="px-2.5 py-1.5 text-left font-semibold">Инстр.</th>
              <th className="px-1.5 py-1.5 text-left font-semibold">тренд</th>
              {PCOLS.map((p) => (
                <th key={p.label} className="px-1.5 py-1.5 text-right font-semibold">{p.label}</th>
              ))}
              <th className="px-1.5 py-1.5 text-right font-semibold">vs&nbsp;SPY</th>
              <th className="px-1.5 py-1.5 text-right font-semibold">vol21</th>
              <th className="px-1.5 py-1.5 text-right font-semibold">52w</th>
            </tr>
          </thead>
          <tbody>
            {block.instruments.map((c) => {
              const m = c.metrics;
              const rs = m && m.returns[63] != null && spy63 != null ? m.returns[63]! - spy63 : null;
              return (
                <tr
                  key={c.def.symbol}
                  className="cursor-pointer border-b border-line text-[12px] last:border-0 hover:bg-surface-2"
                  onClick={() => m && onPick(m, `${c.def.symbol} · ${c.def.title}`)}
                >
                  <td className="px-2.5 py-1.5 text-left">
                    <span className="flex items-center gap-2">
                      <span className="w-10 font-semibold">{c.def.symbol}</span>
                      <span className="text-[11px] text-ink-3">{c.def.title}</span>
                    </span>
                  </td>
                  <td className="px-1.5 py-1.5">
                    {m ? <Sparkline data={m.spark} width={46} height={16} strokeWidth={1.4} /> : <span className="text-ink-3">—</span>}
                  </td>
                  {PCOLS.map((p) => (
                    <td key={p.label} className="px-1.5 py-1.5 text-right tabular-nums">
                      <Pct v={cell(m, p.key)} dim={mode === 'excess'} />
                    </td>
                  ))}
                  <td className="px-1.5 py-1.5 text-right tabular-nums">
                    <Pct v={rs} />
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">
                    {m?.vol21 != null ? m.vol21.toFixed(1) : '—'}
                    {flags(m)}
                  </td>
                  <td className="px-1.5 py-1.5 text-right">
                    <RangeBar v={m?.pct52w ?? null} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailDrawer({
  sel,
  spy,
  onClose,
}: {
  sel: { block: OverviewBlock; m: InstrumentMetrics; title: string };
  spy: InstrumentMetrics | null;
  onClose: () => void;
}) {
  const m = sel.m;
  const stat = (k: string, v: string, tone?: 'up' | 'down') => (
    <div className="rounded-fk-sm bg-surface-2 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{k}</div>
      <div className={`mt-0.5 text-[15px] font-bold tabular-nums ${tone === 'up' ? 'text-up-strong' : tone === 'down' ? 'text-down-strong' : ''}`}>{v}</div>
    </div>
  );
  const r = (key: number | 'ytd') => {
    const v = key === 'ytd' ? m.ytd : m.returns[key] ?? null;
    return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1);
  };
  const tone = (key: number | 'ytd') => {
    const v = key === 'ytd' ? m.ytd : m.returns[key] ?? null;
    return v == null ? undefined : v >= 0 ? 'up' : 'down';
  };
  const vsSpy = spy && m.returns[63] != null && spy.returns[63] != null ? m.returns[63]! - spy.returns[63]! : null;
  return (
    <>
      <div className="fixed inset-0 z-50 bg-[rgba(15,23,41,0.28)] animate-overlay-in" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[51] flex w-[440px] max-w-[92vw] flex-col border-l border-line bg-surface-elev shadow-fk-lg animate-modal-in">
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <div className="text-[15px] font-bold">{sel.title}</div>
            <div className="mt-1.5 flex items-center gap-2">
              {m.returns[1] != null && <Delta value={m.returns[1]!} percent decimals={2} />}
              <Badge variant="brand">{sel.block.def.title.replace('Корзина: ', '')}</Badge>
            </div>
          </div>
          <button className="text-lg leading-none text-ink-3" onClick={onClose}>✕</button>
        </div>
        <div className="overflow-auto px-5 py-4">
          <div className="mb-3 flex h-28 items-center justify-center rounded-fk bg-surface-2">
            <Sparkline data={m.spark} width={380} height={96} strokeWidth={1.8} />
          </div>
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-ink-3">Доходность</div>
          <div className="mb-4 grid grid-cols-3 gap-2.5">
            {stat('1D', r(1), tone(1))}
            {stat('5D', r(5), tone(5))}
            {stat('21D', r(21), tone(21))}
            {stat('63D', r(63), tone(63))}
            {stat('YTD', r('ytd'), tone('ytd'))}
            {stat('vs SPY 63D', vsSpy == null ? '—' : (vsSpy > 0 ? '+' : '') + vsSpy.toFixed(1), vsSpy == null ? undefined : vsSpy >= 0 ? 'up' : 'down')}
          </div>
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-ink-3">Риск / диапазон</div>
          <div className="grid grid-cols-3 gap-2.5">
            {stat('vol21', m.vol21 != null ? m.vol21.toFixed(1) : '—')}
            {stat('vol63', m.vol63 != null ? m.vol63.toFixed(1) : '—')}
            {stat('%52w', m.pct52w != null ? Math.round(m.pct52w) + '%' : '—')}
            {stat('z-score', m.z63 != null ? (m.z63 > 0 ? '+' : '') + m.z63.toFixed(1) : '—')}
            {stat('MTD', m.mtd != null ? (m.mtd > 0 ? '+' : '') + m.mtd.toFixed(1) : '—', m.mtd == null ? undefined : m.mtd >= 0 ? 'up' : 'down')}
            {stat('QTD', m.qtd != null ? (m.qtd > 0 ? '+' : '') + m.qtd.toFixed(1) : '—', m.qtd == null ? undefined : m.qtd >= 0 ? 'up' : 'down')}
          </div>
          <div className="mt-4 text-[12px] text-ink-2">MA200: {m.aboveMA200 == null ? '—' : m.aboveMA200 ? 'выше' : 'ниже'} · MA50: {m.aboveMA50 == null ? '—' : m.aboveMA50 ? 'выше' : 'ниже'}</div>
        </div>
      </div>
    </>
  );
}
