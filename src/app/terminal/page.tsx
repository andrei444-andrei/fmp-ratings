'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Delta, Sparkline, SegmentedControl, Badge, Skeleton } from '@/components/ui';
import type { CorrelationMatrix, InstrumentMetrics, MarketOverview, OverviewBlock } from '@/lib/terminal/types';

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
  if (dim && Math.abs(v) < 0.05) return <span className="tabular-nums text-ink-3">0.0</span>;
  return <Delta value={v} percent={false} decimals={1} showArrow={false} size="sm" />;
}

function RangeBar({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative h-[7px] w-[44px] overflow-hidden rounded-fk-pill bg-surface-2">
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
      {m.z63 != null && Math.abs(m.z63) > 2 && <span className="ml-0.5 text-warn-strong" title="аномалия |z|>2">⚡</span>}
      {m.volRatio != null && m.volRatio > 1.5 && <span className="ml-0.5 font-extrabold text-down-strong" title="vol_ratio>1.5">!</span>}
    </>
  );
}

function corrColor(v: number | null): { bg: string; fg: string } {
  if (v == null) return { bg: 'transparent', fg: 'var(--fk-text-3)' };
  if (v >= 0.999) return { bg: '#eef0f7', fg: 'var(--fk-text-3)' };
  const a = Math.pow(Math.abs(v), 0.85) * 0.82;
  return { bg: v > 0 ? `rgba(244,63,94,${a.toFixed(3)})` : `rgba(16,185,129,${a.toFixed(3)})`, fg: Math.abs(v) > 0.6 ? '#fff' : 'var(--fk-text)' };
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

  const movers = useMemo(() => {
    if (!data) return { up: [] as any[], down: [] as any[], anom: [] as { sym: string; z: number; vr: number | null }[] };
    const all: { sym: string; m: InstrumentMetrics }[] = [];
    const seen = new Set<string>();
    for (const b of data.blocks)
      for (const c of b.instruments)
        if (c.metrics && !seen.has(c.def.symbol)) {
          seen.add(c.def.symbol);
          all.push({ sym: c.def.symbol, m: c.metrics });
        }
    const byR1 = all.filter((x) => x.m.returns[1] != null).sort((a, b) => b.m.returns[1]! - a.m.returns[1]!);
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
    <div className="mx-auto max-w-[1320px] px-4 pb-24 pt-5 sm:px-5">
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
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {data.blocks.map((b) => (
              <BlockCard key={b.def.id} block={b} mode={mode} cell={cell} spy={spy} onPick={(m, title) => setSel({ block: b, m, title })} />
            ))}
          </div>
          {data.correlation && <CorrelationCard corr={data.correlation} />}
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
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
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
            {movers.up.map((x) => <Row3 key={x.sym} sym={x.sym} v={x.m.returns[1]} spark={x.m.spark} />)}
          </Col>
          <Col title="▼ Аутсайдеры" color="var(--fk-down-text)">
            {movers.down.map((x) => <Row3 key={x.sym} sym={x.sym} v={x.m.returns[1]} spark={x.m.spark} />)}
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

function blockBreadth(bm: OverviewBlock['metrics']) {
  return bm.breadthMA200 != null
    ? `${Math.round(bm.breadthMA200)}% >MA200 · ${bm.advancers}↑/${bm.decliners}↓`
    : `${bm.advancers}↑/${bm.decliners}↓`;
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
  return (
    <div className="rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink">{block.def.title}</span>
          {block.def.benchmark && <Badge variant="brand">бенч {block.def.benchmark}</Badge>}
        </div>
        <span className="text-[11px] text-ink-3">{blockBreadth(block.metrics)}</span>
      </div>

      {/* desktop: компактная таблица без горизонтального скролла */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="text-[9.5px] uppercase tracking-wide text-ink-3">
            <th className="py-1.5 pl-3.5 pr-1 text-left font-semibold">Инстр.</th>
            <th className="px-1 py-1.5 text-left font-semibold">тренд</th>
            {PCOLS.map((p) => (
              <th key={p.label} className="px-1 py-1.5 text-right font-semibold">{p.label}</th>
            ))}
            <th className="px-1 py-1.5 text-right font-semibold">vsSPY</th>
            <th className="px-1 py-1.5 text-right font-semibold">vol</th>
            <th className="py-1.5 pl-1 pr-3.5 text-right font-semibold">52w</th>
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
                <td className="py-1.5 pl-3.5 pr-1 text-left">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-9 shrink-0 font-semibold">{c.def.symbol}</span>
                    <span className="max-w-[74px] truncate text-[11px] text-ink-3" title={c.def.title}>{c.def.title}</span>
                  </div>
                </td>
                <td className="px-1 py-1.5">{m ? <Sparkline data={m.spark} width={42} height={16} strokeWidth={1.4} /> : <span className="text-ink-3">—</span>}</td>
                {PCOLS.map((p) => (
                  <td key={p.label} className="px-1 py-1.5 text-right tabular-nums"><Pct v={cell(m, p.key)} dim={mode === 'excess'} /></td>
                ))}
                <td className="px-1 py-1.5 text-right tabular-nums"><Pct v={rs} /></td>
                <td className="px-1 py-1.5 text-right tabular-nums">{m?.vol21 != null ? m.vol21.toFixed(0) : '—'}{flags(m)}</td>
                <td className="py-1.5 pl-1 pr-3.5 text-right"><RangeBar v={m?.pct52w ?? null} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* mobile: карточки инструментов */}
      <div className="md:hidden">
        {block.instruments.map((c) => {
          const m = c.metrics;
          const rs = m && m.returns[63] != null && spy63 != null ? m.returns[63]! - spy63 : null;
          const chip = (label: string, key: number | 'ytd') => (
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[10px] uppercase text-ink-3">{label}</span>
              <span className="tabular-nums"><Pct v={cell(m, key)} dim={mode === 'excess'} /></span>
            </span>
          );
          return (
            <div key={c.def.symbol} className="cursor-pointer border-b border-line px-3.5 py-3 last:border-0 active:bg-surface-2" onClick={() => m && onPick(m, `${c.def.symbol} · ${c.def.title}`)}>
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="text-[14px] font-bold">{c.def.symbol}</span>
                  <span className="truncate text-[12px] text-ink-3">{c.def.title}</span>
                </div>
                <div className="flex flex-none items-center gap-2.5">
                  {m && <Sparkline data={m.spark} width={50} height={16} strokeWidth={1.4} />}
                  {m?.returns[1] != null && <Delta value={cell(m, 1)!} decimals={1} size="sm" />}
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px]">
                {chip('5D', 5)}
                {chip('21D', 21)}
                {chip('63D', 63)}
                {chip('YTD', 'ytd')}
                <span className="inline-flex items-baseline gap-1"><span className="text-[10px] uppercase text-ink-3">vs SPY</span><span className="tabular-nums"><Pct v={rs} /></span></span>
                <span className="inline-flex items-baseline gap-1"><span className="text-[10px] uppercase text-ink-3">vol</span><span className="tabular-nums">{m?.vol21 != null ? m.vol21.toFixed(0) : '—'}</span>{flags(m)}</span>
                <span className="inline-flex items-center gap-1"><span className="text-[10px] uppercase text-ink-3">52w</span><RangeBar v={m?.pct52w ?? null} /></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CorrelationCard({ corr }: { corr: CorrelationMatrix }) {
  return (
    <div className="mt-5 rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink">Корреляционная матрица</span>
          <Badge>кросс-ассет · {corr.window}д</Badge>
        </div>
        <span className="text-[11px] text-ink-3">красный — движутся вместе (риск концентрации) · зелёный — диверсификатор</span>
      </div>
      <div className="overflow-x-auto px-3.5 py-3">
        <table className="border-separate" style={{ borderSpacing: 4 }}>
          <thead>
            <tr>
              <th />
              {corr.symbols.map((s) => (
                <th key={s} className="px-1 pb-1 text-center text-[10.5px] font-semibold text-ink-2">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corr.matrix.map((row, i) => (
              <tr key={corr.symbols[i]}>
                <td className="whitespace-nowrap pr-2 text-right text-[11.5px] font-semibold text-ink" title={corr.titles[i]}>{corr.symbols[i]}</td>
                {row.map((v, j) => {
                  const { bg, fg } = corrColor(v);
                  return (
                    <td key={j}>
                      <div className="flex h-9 w-[50px] items-center justify-center rounded-fk-sm border border-line text-[11.5px] font-semibold tabular-nums" style={{ background: bg, color: fg }}>
                        {v == null ? '—' : i === j ? '1.00' : v.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── Drawer (насыщенный drill-down) ─────────────────────────

const HORIZONS: { label: string; pts: number }[] = [
  { label: '1м', pts: 8 },
  { label: '3м', pts: 20 },
  { label: '6м', pts: 40 },
  { label: '1г', pts: 72 },
  { label: 'макс', pts: 999 },
];

function BarRow({ label, value, max, suffix = '' }: { label: string; value: number | null; max: number; suffix?: string }) {
  const pos = value != null && value >= 0;
  const w = value == null ? 0 : Math.min(50, (Math.abs(value) / max) * 50);
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-9 shrink-0 text-ink-3">{label}</span>
      <div className="relative h-3.5 flex-1 rounded bg-surface-2">
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        {value != null && (
          <div className="absolute inset-y-[2px] rounded-[3px]" style={{ [pos ? 'left' : 'right']: '50%', width: `${w}%`, background: pos ? 'var(--fk-up)' : 'var(--fk-down)' } as any} />
        )}
      </div>
      <span className={`w-12 shrink-0 text-right font-semibold tabular-nums ${value == null ? 'text-ink-3' : pos ? 'text-up-strong' : 'text-down-strong'}`}>
        {value == null ? '—' : (value > 0 ? '+' : '') + value.toFixed(1) + suffix}
      </span>
    </div>
  );
}

function Chip({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' | 'warn' }) {
  const cls = tone === 'up' ? 'text-up-strong' : tone === 'down' ? 'text-down-strong' : tone === 'warn' ? 'text-warn-strong' : 'text-ink';
  return (
    <div className="rounded-fk-sm bg-surface-2 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{k}</div>
      <div className={`mt-0.5 text-[14px] font-bold tabular-nums ${cls}`}>{v}</div>
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
  const [hz, setHz] = useState('1г');
  const [chartMode, setChartMode] = useState<'price' | 'norm'>('price');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pts = HORIZONS.find((h) => h.label === hz)?.pts ?? 999;
  const spark = m.spark.slice(-Math.min(pts, m.spark.length));
  const sparkD = m.sparkT.slice(-Math.min(pts, m.sparkT.length));

  const retItems: { label: string; v: number | null }[] = [
    { label: '1н', v: m.returns[5] },
    { label: '1м', v: m.returns[21] },
    { label: '3м', v: m.returns[63] },
    { label: '6м', v: m.returns[126] },
    { label: '1г', v: m.returns[252] },
  ];
  const retMax = Math.max(1, ...retItems.map((i) => (i.v == null ? 0 : Math.abs(i.v))));

  const rsItems: { label: string; v: number | null }[] = [21, 63, 126, 252].map((w) => ({
    label: w === 21 ? '1м' : w === 63 ? '3м' : w === 126 ? '6м' : '1г',
    v: spy && m.returns[w] != null && spy.returns[w] != null ? m.returns[w]! - spy.returns[w]! : null,
  }));
  const rsMax = Math.max(1, ...rsItems.map((i) => (i.v == null ? 0 : Math.abs(i.v))));
  const rs63 = rsItems[1].v;
  const rsTag = rs63 == null ? null : rs63 > 1 ? { t: 'Лидирует', c: 'up' as const } : rs63 < -1 ? { t: 'Отстаёт', c: 'down' as const } : { t: 'В рынке', c: undefined };

  const last1d = m.returns[1];
  const big = m.last != null ? m.last.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';

  return (
    <>
      <div className="fixed inset-0 z-50 bg-[rgba(15,23,41,0.32)] animate-overlay-in" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[51] flex w-[460px] max-w-[94vw] flex-col border-l border-line bg-surface-elev shadow-fk-lg animate-modal-in">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[17px] font-extrabold">{m.symbol}</span>
              {flags(m)}
            </div>
            <div className="truncate text-[12.5px] text-ink-3">{sel.title.split(' · ')[1] ?? ''}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[20px] font-bold tabular-nums">{big}</span>
              {last1d != null && <Delta value={last1d} percent decimals={2} variant="pill" />}
              <Badge variant="brand">{sel.block.def.title.replace('Корзина: ', '')}</Badge>
              {sel.block.def.benchmark && <Badge>бенч {sel.block.def.benchmark}</Badge>}
            </div>
          </div>
          <button className="rounded-fk-sm px-1.5 text-lg leading-none text-ink-3 hover:bg-surface-2" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {/* график: цена / нормализованная доходность · горизонт · ховер дата→цена */}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl size="sm" value={chartMode} onChange={(v) => setChartMode(v as 'price' | 'norm')} options={[{ label: 'Цена', value: 'price' }, { label: 'Доходность %', value: 'norm' }]} />
            <SegmentedControl size="sm" value={hz} onChange={setHz} options={HORIZONS.map((h) => ({ label: h.label, value: h.label }))} />
          </div>
          <div className="mb-4 rounded-fk bg-surface-2 p-2">
            <PriceChart prices={spark.length >= 2 ? spark : m.spark} dates={sparkD.length >= 2 ? sparkD : m.sparkT} normalized={chartMode === 'norm'} />
          </div>

          {/* доходность — term structure (+ YTD инлайном) */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-3">Доходность · структура по срокам</span>
            <span className="text-[11px] text-ink-2">YTD <b className={m.ytd == null ? 'text-ink-3' : m.ytd >= 0 ? 'text-up-strong' : 'text-down-strong'}>{fmt(m.ytd)}%</b></span>
          </div>
          <div className="mb-4 space-y-1">
            {retItems.map((it) => <BarRow key={it.label} label={it.label} value={it.v} max={retMax} suffix="%" />)}
          </div>

          {/* относительная сила */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-3">Относительная сила vs SPY</span>
            {rsTag && <Badge variant={rsTag.c === 'up' ? 'up' : rsTag.c === 'down' ? 'down' : 'neutral'}>{rsTag.t}</Badge>}
          </div>
          <div className="mb-4 space-y-1">
            {rsItems.map((it) => <BarRow key={it.label} label={it.label} value={it.v} max={rsMax} suffix="%" />)}
          </div>

          {/* риск и диапазон */}
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-ink-3">Риск и диапазон</div>
          {m.pct52w != null && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] text-ink-3">52н низ</span>
              <div className="relative h-2 flex-1 rounded-fk-pill bg-surface-2">
                <div className="absolute -top-[5px] h-[18px] w-[18px] -translate-x-1/2 rounded-fk-pill border-[3px] border-brand bg-white shadow-fk-sm" style={{ left: `${Math.max(0, Math.min(100, m.pct52w))}%` }} />
              </div>
              <span className="text-[10px] text-ink-3">верх</span>
              <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-ink-2">{Math.round(m.pct52w)}%</span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Chip k="vol21" v={m.vol21 != null ? m.vol21.toFixed(1) : '—'} />
            <Chip k="vol21/63" v={m.volRatio != null ? '×' + m.volRatio.toFixed(2) : '—'} tone={m.volRatio != null && m.volRatio > 1.5 ? 'warn' : undefined} />
            <Chip k="z-score" v={m.z63 != null ? (m.z63 > 0 ? '+' : '') + m.z63.toFixed(1) : '—'} tone={m.z63 != null && Math.abs(m.z63) > 2 ? 'warn' : undefined} />
            <Chip k="MA50" v={m.aboveMA50 == null ? '—' : m.aboveMA50 ? 'выше' : 'ниже'} tone={m.aboveMA50 == null ? undefined : m.aboveMA50 ? 'up' : 'down'} />
            <Chip k="MA200" v={m.aboveMA200 == null ? '—' : m.aboveMA200 ? 'выше' : 'ниже'} tone={m.aboveMA200 == null ? undefined : m.aboveMA200 ? 'up' : 'down'} />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button className="rounded-fk-sm border border-line-strong bg-surface-elev px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-surface-2">＋ в сравнение</button>
            <button className="rounded-fk-sm border border-line-strong bg-surface-elev px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-surface-2">📌 в watchlist</button>
          </div>
          {m.synthetic && <div className="mt-3 text-[11px] text-warn-strong">демо-данные (нет ключей провайдеров) — не рыночная картина</div>}
        </div>
      </div>
    </>
  );
}

function PriceChart({ prices, dates, normalized }: { prices: number[]; dates: string[]; normalized: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(400);
  const [hi, setHi] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth || 400);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 140;
  const pad = 8;
  const base = prices.length ? prices[0] : 1;
  const vals = normalized && base ? prices.map((p) => (p / base - 1) * 100) : prices;
  const n = vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const X = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (w - 1));
  const Y = (v: number) => pad + (H - 2 * pad) - ((v - min) / span) * (H - 2 * pad);
  const up = n >= 2 ? vals[n - 1] >= vals[0] : true;
  const color = up ? 'var(--fk-up)' : 'var(--fk-down)';
  const gid = `pc-${up ? 'u' : 'd'}`;
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(n - 1).toFixed(1)} ${H} L0 ${H} Z`;
  // ключ анимации: меняется при смене режима/горизонта/инструмента → линия «рисуется» заново
  const animKey = `${normalized ? 'n' : 'p'}-${n}-${Math.round((prices[0] || 0) * 100)}`;
  const fmtDate = (d: string) => {
    const t = new Date(d + 'T00:00:00');
    return isNaN(t.getTime()) ? d : t.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });
  };
  const onMove = (e: any) => {
    if (n < 2) return;
    const i = Math.max(0, Math.min(n - 1, Math.round((e.nativeEvent.offsetX / (w || 1)) * (n - 1))));
    setHi(i);
  };
  const tipLeft = hi == null ? 0 : Math.max(2, Math.min(w - 110, X(hi) - 55));
  return (
    <div ref={ref} className="relative select-none" style={{ height: H }} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      {n >= 2 && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {normalized && <line x1="0" x2={w} y1={Y(0).toFixed(1)} y2={Y(0).toFixed(1)} stroke="var(--fk-line-strong)" strokeDasharray="3 3" />}
          <path key={`area-${animKey}`} d={area} fill={`url(#${gid})`} className="animate-overlay-in" />
          <path
            key={`line-${animKey}`}
            d={line}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="animate-draw-line"
            style={{ strokeDasharray: 1, strokeDashoffset: 1 }}
          />
          {hi != null && (
            <>
              <line x1={X(hi)} x2={X(hi)} y1={0} y2={H} stroke="var(--fk-line-strong)" />
              <circle cx={X(hi)} cy={Y(vals[hi])} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
            </>
          )}
        </svg>
      )}
      {hi != null && (
        <div className="pointer-events-none absolute top-1 rounded-fk-sm border border-line bg-surface-elev px-2 py-1 text-[11px] shadow-fk-sm" style={{ left: tipLeft }}>
          <div className="text-ink-3">{fmtDate(dates[hi] ?? '')}</div>
          <div className="font-semibold tabular-nums">
            {normalized ? `${vals[hi] > 0 ? '+' : ''}${vals[hi].toFixed(1)}%` : prices[hi]?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(v: number | null): string {
  return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1);
}
function toneOf(v: number | null): 'up' | 'down' | undefined {
  return v == null ? undefined : v >= 0 ? 'up' : 'down';
}
