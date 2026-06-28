'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Delta, Sparkline, SegmentedControl, Badge, Skeleton, Modal, Button, Input, Spinner } from '@/components/ui';
import { SEED_BLOCKS } from '@/lib/terminal/registry';
import RotationCard from './RotationCard';
import type { CorrelationMatrix, InstrumentMetrics, MarketOverview, OverviewBlock } from '@/lib/terminal/types';

const PCOLS: { key: number | 'ytd'; label: string }[] = [
  { key: 1, label: '1D' },
  { key: 5, label: '5D' },
  { key: 21, label: '21D' },
  { key: 63, label: '63D' },
  { key: 'ytd', label: 'YTD' },
];

type Mode = 'abs' | 'excess';
type CustomBasket = { id: string; title: string; members: string[] };
type TermConfig = {
  compare: { symbols: string[]; period: string; showAvg: boolean };
  corr: { symbols: string[] };
  blocks: Record<string, string[]>;
  watchlist: string[];
  customBaskets: CustomBasket[];
  hiddenBlocks: string[];
  blockTitles: Record<string, string>;
};
type SearchItem = { symbol: string; name: string; exchange?: string; note?: string };

const EMPTY_CFG: TermConfig = { compare: { symbols: ['SPY', 'QQQ', 'DIA'], period: '1Г', showAvg: false }, corr: { symbols: [] }, blocks: {}, watchlist: [], customBaskets: [], hiddenBlocks: [], blockTitles: {} };
const SEED_TITLE: Record<string, string> = Object.fromEntries(SEED_BLOCKS.map((b) => [b.id, b.title]));
const SYM_RE = /^[A-Z0-9.\-]{1,12}$/;

const CPALETTE = ['#6d5bf0', '#3b82f6', '#f59e0b', '#12b981', '#ef4444', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6', '#d4a017', '#64748b', '#f97316'];
function colorFor(sym: string): string {
  let h = 7;
  for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return CPALETTE[h % CPALETTE.length];
}
const COMPARE_PERIODS: { label: string; days: number }[] = [
  { label: '1М', days: 31 },
  { label: '3М', days: 93 },
  { label: '6М', days: 186 },
  { label: 'YTD', days: -1 },
  { label: '1Г', days: 370 },
];

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
  const [cfg, setCfg] = useState<TermConfig | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const npfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/market/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message || 'ошибка загрузки'));
    fetch('/api/market/config')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('config'))))
      .then((c) => alive && setCfg({
        ...EMPTY_CFG,
        ...c,
        compare: { ...EMPTY_CFG.compare, ...(c?.compare ?? {}) },
        blocks: c?.blocks ?? {},
        watchlist: c?.watchlist ?? [],
        customBaskets: Array.isArray(c?.customBaskets) ? c.customBaskets : [],
        hiddenBlocks: Array.isArray(c?.hiddenBlocks) ? c.hiddenBlocks : [],
        blockTitles: c?.blockTitles ?? {},
      }))
      .catch(() => alive && setCfg(EMPTY_CFG));
    return () => {
      alive = false;
    };
  }, []);

  // обновление конфига: мгновенно в UI + дебаунс-сохранение на сервер
  const updateCfg = (next: TermConfig) => {
    setCfg(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/market/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {});
    }, 600);
  };

  // клик по заголовку блока/корзины → загрузить инструменты в график сравнения, включить
  // линию Σ (eq-weight) для корзин и промотать к графику
  const loadBlockToCompare = (symbols: string[], isBasket = false) => {
    if (!cfg) return;
    updateCfg({ ...cfg, compare: { ...cfg.compare, symbols: symbols.slice(0, 12), showAvg: isBasket || cfg.compare.showAvg } });
    setTimeout(() => npfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const addToCompare = (sym: string) => {
    if (!cfg) return;
    const syms = cfg.compare.symbols.includes(sym) ? cfg.compare.symbols : [...cfg.compare.symbols, sym].slice(0, 12);
    updateCfg({ ...cfg, compare: { ...cfg.compare, symbols: syms } });
    setSel(null);
    setTimeout(() => npfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // вайт-лист (избранное): тоггл одного тикера — мгновенно в UI + дебаунс-сохранение
  const isFav = (sym: string) => cfg?.watchlist?.includes(sym) ?? false;
  const toggleFav = (sym: string) => {
    if (!cfg) return;
    const next = cfg.watchlist.includes(sym) ? cfg.watchlist.filter((x) => x !== sym) : [...cfg.watchlist, sym];
    updateCfg({ ...cfg, watchlist: next });
  };

  // открыть drawer по символу (из вайт-листа): ищем инструмент с метриками в любом блоке
  const openSymbol = (sym: string) => {
    if (!data) return;
    for (const b of data.blocks) for (const c of b.instruments) if (c.def.symbol === sym && c.metrics) return setSel({ block: b, m: c.metrics, title: `${sym} · ${c.def.title}` });
  };

  // редактор виджета/корзины: немедленное сохранение конфига + пересчёт overview
  const [editor, setEditor] = useState<{ block: OverviewBlock; mode: 'edit' | 'create' } | null>(null);
  const [busyBlock, setBusyBlock] = useState(false);
  const reloadOverview = async () => {
    try {
      const r = await fetch('/api/market/overview', { cache: 'no-store' });
      if (r.ok) setData(await r.json());
    } catch {
      /* оставляем предыдущие данные */
    }
  };
  // общий коммит конфига: мгновенно в UI + немедленный POST + пересчёт overview
  const commitCfg = async (next: TermConfig) => {
    if (saveTimer.current) clearTimeout(saveTimer.current); // отменяем отложенный дебаунс
    setCfg(next);
    setBusyBlock(true);
    try {
      await fetch('/api/market/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
      await reloadOverview();
    } catch {
      /* graceful */
    }
    setBusyBlock(false);
  };

  const openCreateBasket = () => {
    const id = `custom_${Date.now().toString(36)}`;
    const def = { id, title: '', type: 'basket' as const, benchmark: 'SPY', members: [] as string[], custom: true };
    setEditor({ block: { def, metrics: {} as any, instruments: [] }, mode: 'create' });
  };

  // сохранить состав/название блока (seed → blocks+blockTitles; custom → customBaskets)
  const saveBlock = async (kind: 'seed' | 'custom', id: string, title: string, members: string[]) => {
    if (!cfg || !members.length) return;
    let next: TermConfig;
    if (kind === 'custom') {
      const exists = cfg.customBaskets.some((b) => b.id === id);
      const customBaskets = exists
        ? cfg.customBaskets.map((b) => (b.id === id ? { ...b, title, members } : b))
        : [...cfg.customBaskets, { id, title, members }];
      next = { ...cfg, customBaskets };
    } else {
      const blockTitles = { ...cfg.blockTitles };
      if (title && title !== SEED_TITLE[id]) blockTitles[id] = title;
      else delete blockTitles[id];
      next = { ...cfg, blocks: { ...cfg.blocks, [id]: members }, blockTitles };
    }
    await commitCfg(next);
    setEditor(null);
  };

  // сброс seed-блока к стандарту (состав + название)
  const resetBlock = async (id: string) => {
    if (!cfg) return;
    const blocks = { ...cfg.blocks };
    delete blocks[id];
    const blockTitles = { ...cfg.blockTitles };
    delete blockTitles[id];
    await commitCfg({ ...cfg, blocks, blockTitles });
    setEditor(null);
  };

  // удалить блок: custom → выкинуть из списка; seed → скрыть
  const deleteBlock = async (kind: 'seed' | 'custom', id: string) => {
    if (!cfg) return;
    const next = kind === 'custom'
      ? { ...cfg, customBaskets: cfg.customBaskets.filter((b) => b.id !== id) }
      : { ...cfg, hiddenBlocks: cfg.hiddenBlocks.includes(id) ? cfg.hiddenBlocks : [...cfg.hiddenBlocks, id] };
    await commitCfg(next);
    setEditor(null);
  };

  const restoreHidden = async (id: string) => {
    if (!cfg) return;
    await commitCfg({ ...cfg, hiddenBlocks: cfg.hiddenBlocks.filter((x) => x !== id) });
  };

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

  // карта symbol→{def,metrics} и списки тикеров по блокам (для графика и матрицы)
  const instrMap = useMemo(() => {
    const m = new Map<string, { title: string; metrics: InstrumentMetrics | null }>();
    if (data) for (const b of data.blocks) for (const c of b.instruments) if (!m.has(c.def.symbol)) m.set(c.def.symbol, { title: c.def.title, metrics: c.metrics });
    return m;
  }, [data]);
  const groups = useMemo(() => {
    if (!data) return [] as { title: string; items: { sym: string; title: string }[] }[];
    return data.blocks.map((b) => ({ title: b.def.title.replace('Корзина: ', ''), items: b.instruments.map((c) => ({ sym: c.def.symbol, title: c.def.title })) }));
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
          {cfg && cfg.watchlist.length > 0 && (
            <WatchlistBar
              watchlist={cfg.watchlist}
              instrMap={instrMap}
              onOpen={openSymbol}
              onRemove={toggleFav}
              onCompareAll={() => loadBlockToCompare(cfg.watchlist)}
            />
          )}
          <div ref={npfRef} className="scroll-mt-3">
            {cfg && (
              <NormalizedPerformance
                instrMap={instrMap}
                groups={groups}
                symbols={cfg.compare.symbols}
                period={cfg.compare.period}
                showAvg={cfg.compare.showAvg}
                onChange={(symbols, period) => updateCfg({ ...cfg, compare: { ...cfg.compare, symbols, period } })}
                onToggleAvg={() => updateCfg({ ...cfg, compare: { ...cfg.compare, showAvg: !cfg.compare.showAvg } })}
              />
            )}
          </div>
          {/* Макро/ротация — компактные виджеты (≈50%); сюда же добавятся ставки/волатильность/события */}
          <div className="mb-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            <RotationCard />
          </div>
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {data.blocks.map((b) => (
              <BlockCard
                key={b.def.id}
                block={b}
                mode={mode}
                cell={cell}
                spy={spy}
                isFav={isFav}
                onToggleFav={toggleFav}
                onPick={(m, title) => setSel({ block: b, m, title })}
                onCompare={loadBlockToCompare}
                onEdit={() => setEditor({ block: b, mode: 'edit' })}
                onDelete={() => deleteBlock(b.def.custom ? 'custom' : 'seed', b.def.id)}
              />
            ))}
            <button
              type="button"
              onClick={openCreateBasket}
              className="flex min-h-[120px] items-center justify-center gap-2 rounded-fk border-2 border-dashed border-line-strong text-[13px] font-semibold text-ink-2 transition-colors hover:border-brand hover:bg-brand-50 hover:text-brand-700"
            >
              ＋ Создать корзину
            </button>
          </div>
          {cfg && cfg.hiddenBlocks.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              <span>Скрытые блоки:</span>
              {cfg.hiddenBlocks.map((id) => (
                <button key={id} onClick={() => restoreHidden(id)} disabled={busyBlock} className="rounded-fk-pill border border-line px-2.5 py-0.5 font-semibold hover:border-brand hover:text-brand" title="Восстановить блок">
                  {SEED_TITLE[id] ?? id} ↩
                </button>
              ))}
            </div>
          )}
          {data.correlation && cfg && (
            <CorrelationCard
              corr={data.correlation}
              groups={groups}
              selected={cfg.corr.symbols}
              onChange={(symbols) => updateCfg({ ...cfg, corr: { symbols } })}
            />
          )}
        </>
      )}

      {sel && (
        <DetailDrawer
          sel={sel}
          spy={spy}
          isFav={isFav(sel.m.symbol)}
          onToggleFav={() => toggleFav(sel.m.symbol)}
          onAddCompare={() => addToCompare(sel.m.symbol)}
          onClose={() => setSel(null)}
        />
      )}
      {editor && (
        <BlockEditor
          key={editor.block.def.id}
          block={editor.block}
          mode={editor.mode}
          busy={busyBlock}
          onClose={() => !busyBlock && setEditor(null)}
          onSave={(title, members) => saveBlock(editor.block.def.custom ? 'custom' : 'seed', editor.block.def.id, title, members)}
          onReset={() => resetBlock(editor.block.def.id)}
          onDelete={() => deleteBlock(editor.block.def.custom ? 'custom' : 'seed', editor.block.def.id)}
        />
      )}
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

function FavStar({ on, onClick }: { on: boolean; onClick: (e: ReactMouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={on ? 'Убрать из избранного' : 'В избранное'}
      aria-pressed={on}
      className={`flex-none rounded px-0.5 text-[13px] leading-none transition-opacity ${on ? 'opacity-100' : 'text-ink-3 opacity-30 hover:opacity-90'}`}
      style={on ? { color: '#f59e0b' } : undefined}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

// Полоска вайт-листа (избранное): чипы с дневным движением, клик → drawer, ✕ → убрать.
function WatchlistBar({
  watchlist,
  instrMap,
  onOpen,
  onRemove,
  onCompareAll,
}: {
  watchlist: string[];
  instrMap: Map<string, { title: string; metrics: InstrumentMetrics | null }>;
  onOpen: (sym: string) => void;
  onRemove: (sym: string) => void;
  onCompareAll: () => void;
}) {
  return (
    <div className="mb-3.5 rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink"><span style={{ color: '#f59e0b' }}>★</span> Избранное</span>
          <Badge>{watchlist.length}</Badge>
        </div>
        <button onClick={onCompareAll} className="rounded-fk-sm border border-line-strong px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:border-brand-100 hover:bg-brand-50 hover:text-brand-700" title="Загрузить избранное в график сравнения">↗ всё в сравнение</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
        {watchlist.map((sym) => {
          const r1 = instrMap.get(sym)?.metrics?.returns[1] ?? null;
          return (
            <span key={sym} className="inline-flex items-center gap-1.5 rounded-fk-pill border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-[12px] font-semibold">
              <button type="button" className="hover:text-brand" onClick={() => onOpen(sym)} title="Открыть карточку">{sym}</button>
              {r1 != null && <span className={`tabular-nums ${r1 >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>{(r1 > 0 ? '+' : '') + r1.toFixed(1)}%</span>}
              <span className="cursor-pointer rounded px-1 text-ink-3 hover:bg-line hover:text-down-strong" onClick={() => onRemove(sym)} title="Убрать из избранного">✕</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BlockCard({
  block,
  mode,
  cell,
  spy,
  isFav,
  onToggleFav,
  onPick,
  onCompare,
  onEdit,
  onDelete,
}: {
  block: OverviewBlock;
  mode: Mode;
  cell: (m: InstrumentMetrics | null, key: number | 'ytd') => number | null;
  spy: InstrumentMetrics | null;
  isFav: (sym: string) => boolean;
  onToggleFav: (sym: string) => void;
  onPick: (m: InstrumentMetrics, title: string) => void;
  onCompare?: (symbols: string[], isBasket?: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const spy63 = spy?.returns[63] ?? null;
  const isBasket = block.def.type === 'basket';
  const agg = block.metrics.agg; // может отсутствовать в старом снапшоте → null-safe
  // общая (equal-weight) доходность корзины по колонке, с учётом режима «Превышение SPY»
  const aggVal = (key: number | 'ytd') => {
    const raw = key === 'ytd' ? agg?.ytd ?? null : agg?.returns?.[key] ?? null;
    if (raw == null) return null;
    if (mode === 'excess') {
      const b = key === 'ytd' ? spy?.ytd ?? null : spy?.returns[key] ?? null;
      return b == null ? null : raw - b;
    }
    return raw;
  };
  const agg63 = agg?.returns?.[63] ?? null;
  const aggRs = agg63 != null && spy63 != null ? agg63 - spy63 : null;
  return (
    <div className="rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onCompare?.(block.instruments.map((c) => c.def.symbol), isBasket)}
            title={isBasket ? 'Показать корзину на графике сравнения (с линией Σ)' : 'Показать инструменты блока в графике сравнения'}
            className="group flex items-center gap-1.5 text-[13px] font-bold text-ink hover:text-brand"
          >
            {block.def.title}
            <span className="text-[11px] font-normal text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>↗ сравнить</span>
          </button>
          {block.def.benchmark && <Badge variant="brand">бенч {block.def.benchmark}</Badge>}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden text-[11px] text-ink-3 sm:inline">{blockBreadth(block.metrics)}</span>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              title="Редактировать название и состав"
              className="rounded-fk-sm border border-line-strong px-2 py-0.5 text-[11px] font-semibold text-ink-2 hover:border-brand-100 hover:bg-brand-50 hover:text-brand-700"
            >
              ✎ тикеры
            </button>
          )}
          {isBasket && onDelete && (
            <button
              type="button"
              onClick={() => {
                const msg = block.def.custom
                  ? `Удалить корзину «${block.def.title}» безвозвратно?`
                  : `Скрыть корзину «${block.def.title}»? Вернуть можно из «Скрытые блоки».`;
                if (window.confirm(msg)) onDelete();
              }}
              title="Удалить корзину"
              className="rounded-fk-sm border border-line-strong px-2 py-0.5 text-[11px] font-semibold text-ink-3 hover:border-down hover:bg-down-soft hover:text-down-strong"
            >
              🗑
            </button>
          )}
        </div>
      </div>

      {/* desktop: компактная таблица без горизонтального скролла */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="text-[9.5px] uppercase tracking-wide text-ink-3">
            <th className="py-1.5 pl-2.5 pr-1 text-left font-semibold">Инстр.</th>
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
                <td className="py-1.5 pl-2.5 pr-1 text-left">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <FavStar on={isFav(c.def.symbol)} onClick={(e) => { e.stopPropagation(); onToggleFav(c.def.symbol); }} />
                    <span className="w-9 shrink-0 font-semibold">{c.def.symbol}</span>
                    <span className="max-w-[68px] truncate text-[11px] text-ink-3" title={c.def.title}>{c.def.title}</span>
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
          {isBasket && (
            <tr className="border-t-2 border-line-strong bg-surface-2 text-[12px] font-bold">
              <td className="py-2 pl-2.5 pr-1 text-left" colSpan={2}>
                Σ корзина <span className="font-normal text-ink-3">eq-weight</span>
              </td>
              {PCOLS.map((p) => (
                <td key={p.label} className="px-1 py-2 text-right tabular-nums"><Pct v={aggVal(p.key)} dim={mode === 'excess'} /></td>
              ))}
              <td className="px-1 py-2 text-right tabular-nums"><Pct v={aggRs} /></td>
              <td />
              <td />
            </tr>
          )}
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
                <div className="flex min-w-0 items-center gap-1.5">
                  <FavStar on={isFav(c.def.symbol)} onClick={(e) => { e.stopPropagation(); onToggleFav(c.def.symbol); }} />
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
        {isBasket && (
          <div className="border-t-2 border-line-strong bg-surface-2 px-3.5 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold">Σ корзина <span className="font-normal text-ink-3">eq-weight</span></span>
              {aggVal(1) != null && <Delta value={aggVal(1)!} decimals={1} size="sm" />}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] font-semibold">
              {(['5', '21', '63'] as const).map((k) => (
                <span key={k} className="inline-flex items-baseline gap-1">
                  <span className="text-[10px] uppercase text-ink-3">{k}D</span>
                  <span className="tabular-nums"><Pct v={aggVal(Number(k))} dim={mode === 'excess'} /></span>
                </span>
              ))}
              <span className="inline-flex items-baseline gap-1"><span className="text-[10px] uppercase text-ink-3">YTD</span><span className="tabular-nums"><Pct v={aggVal('ytd')} dim={mode === 'excess'} /></span></span>
              <span className="inline-flex items-baseline gap-1"><span className="text-[10px] uppercase text-ink-3">vs SPY</span><span className="tabular-nums"><Pct v={aggRs} /></span></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type Grp = { title: string; items: { sym: string; title: string }[] };

function TickerPicker({ groups, selected, onToggle }: { groups: Grp[]; selected: Set<string>; onToggle: (sym: string) => void }) {
  return (
    <div className="border-b border-line bg-surface px-3.5 py-3">
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-3">{g.title}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => {
                const on = selected.has(it.sym);
                return (
                  <button key={it.sym} onClick={() => onToggle(it.sym)} className={`flex w-full items-center gap-2 rounded-fk-sm px-2 py-1 text-left text-[12px] ${on ? 'bg-brand-50 text-brand-700' : 'hover:bg-surface-2'}`}>
                    <span className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[4px] border text-[9px] leading-none ${on ? 'border-brand bg-brand text-white' : 'border-line-strong'}`}>{on ? '✓' : ''}</span>
                    <span className="font-semibold">{it.sym}</span>
                    <span className="truncate text-ink-3">{it.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CorrelationCard({ corr, groups, selected, onChange }: { corr: CorrelationMatrix; groups: Grp[]; selected: string[]; onChange: (symbols: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const idx = new Map(corr.symbols.map((s, i) => [s, i] as const));
  const shown = (selected.length ? selected : corr.symbols.slice(0, 10)).filter((s) => idx.has(s));
  const toggle = (s: string) => {
    const set = new Set(shown);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    onChange([...set]);
  };
  return (
    <div className="mt-5 rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink">Корреляционная матрица</span>
          <Badge>кросс-ассет · {corr.window}д</Badge>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden text-[11px] text-ink-3 lg:inline">красный — вместе (риск) · зелёный — диверсификатор</span>
          <button className={`rounded-fk-sm border px-2.5 py-1 text-[11px] font-semibold ${editing ? 'border-brand-100 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-2'}`} onClick={() => setEditing((v) => !v)}>{editing ? '✓ готово' : '✎ настроить'}</button>
        </div>
      </div>
      {editing && <TickerPicker groups={groups} selected={new Set(shown)} onToggle={toggle} />}
      <div className="overflow-x-auto px-3.5 py-3">
        {shown.length < 2 ? (
          <div className="px-2 py-6 text-center text-[12px] text-ink-3">Выберите ≥2 тикера через «✎ настроить»</div>
        ) : (
          <table className="border-separate" style={{ borderSpacing: 4 }}>
            <thead>
              <tr>
                <th />
                {shown.map((s) => <th key={s} className="px-1 pb-1 text-center text-[10.5px] font-semibold text-ink-2">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((rs) => (
                <tr key={rs}>
                  <td className="whitespace-nowrap pr-2 text-right text-[11.5px] font-semibold text-ink">{rs}</td>
                  {shown.map((cs) => {
                    const v = rs === cs ? 1 : corr.matrix[idx.get(rs)!][idx.get(cs)!];
                    const { bg, fg } = corrColor(v);
                    return (
                      <td key={cs}>
                        <div className="flex h-9 w-[50px] items-center justify-center rounded-fk-sm border border-line text-[11.5px] font-semibold tabular-nums" style={{ background: bg, color: fg }}>
                          {v == null ? '—' : rs === cs ? '1.00' : v.toFixed(2)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Редактор виджета/корзины: название + состав (ручной ввод и поиск по тикеру / AI-подбор),
// сброс к стандарту (для сид-блоков) или удаление (для корзин). Всё хранится на сервере.
function BlockEditor({ block, mode: editMode, busy, onClose, onSave, onReset, onDelete }: {
  block: OverviewBlock;
  mode: 'edit' | 'create';
  busy: boolean;
  onClose: () => void;
  onSave: (title: string, members: string[]) => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const isCustom = !!block.def.custom;
  const isBasket = block.def.type === 'basket';
  const isCreate = editMode === 'create';
  const canReset = !isCustom && !isCreate; // сид-блок можно сбросить к стандарту
  const canDelete = !isCreate && (isCustom || isBasket); // корзины (сид/кастом) можно удалить/скрыть
  const [title, setTitle] = useState<string>(block.def.title);
  const [members, setMembers] = useState<string[]>(block.instruments.map((c) => c.def.symbol));
  const [manual, setManual] = useState('');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'symbol' | 'ai'>('symbol');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const add = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s || !SYM_RE.test(s)) return;
    setMembers((m) => (m.includes(s) ? m : [...m, s].slice(0, 24)));
  };
  const addManual = () => { manual.split(/[\s,]+/).forEach(add); setManual(''); };
  const remove = (s: string) => setMembers((m) => m.filter((x) => x !== s));

  const runSearch = async () => {
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    setNote(null);
    try {
      const r = await fetch('/api/market/ticker-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, mode, context: { title: block.def.title, members } }),
      });
      const d = await r.json();
      setResults(Array.isArray(d.items) ? d.items : []);
      setNote(typeof d.note === 'string' ? d.note : null);
    } catch {
      setResults([]);
      setNote('Ошибка поиска');
    }
    setSearching(false);
  };

  const titleOk = !isCustom || title.trim().length > 0; // у кастомной корзины название обязательно
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isCreate ? 'Новая корзина' : `Редактировать · ${block.def.title.replace('Корзина: ', '')}`}
      description={block.def.benchmark ? `Бенчмарк — ${block.def.benchmark} (не редактируется). Задайте название, состав вручную или через поиск.` : 'Задайте название и состав — вручную или через поиск.'}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="primary" size="sm" onClick={() => onSave(title.trim(), members)} loading={busy} disabled={members.length === 0 || !titleOk}>{isCreate ? 'Создать' : 'Сохранить'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* название */}
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">Название</div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isBasket ? 'Напр. AI-инфраструктура' : 'Название блока'} invalid={!titleOk} />
        </div>

        {/* текущий состав */}
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">В виджете · {members.length}</div>
          <div className="flex flex-wrap gap-1.5">
            {members.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-fk-pill border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-[12px] font-semibold">
                {s}
                <span className="cursor-pointer rounded px-1 text-ink-3 hover:bg-line hover:text-down-strong" onClick={() => remove(s)} title="Убрать">✕</span>
              </span>
            ))}
            {members.length === 0 && <span className="text-[12px] text-ink-3">Пусто — добавьте хотя бы один тикер</span>}
          </div>
        </div>

        {/* ручной ввод */}
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">Добавить вручную</div>
          <div className="flex gap-2">
            <Input value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }} placeholder="NVDA, AVGO, ASML…" className="flex-1" />
            <Button variant="secondary" size="sm" onClick={addManual}>Добавить</Button>
          </div>
        </div>

        {/* поиск: по тикеру / AI-подбор */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Поиск тикеров</span>
            <SegmentedControl size="sm" value={mode} onChange={(v) => setMode(v as 'symbol' | 'ai')} options={[{ label: 'По тикеру', value: 'symbol' }, { label: 'AI-подбор', value: 'ai' }]} />
          </div>
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }} placeholder={mode === 'ai' ? 'Тема: «уран и атомная энергетика»' : 'AAPL, Apple, золото…'} className="flex-1" />
            <Button variant="secondary" size="sm" onClick={runSearch} loading={searching}>{mode === 'ai' ? 'Подобрать' : 'Найти'}</Button>
          </div>
          {mode === 'ai' && <div className="mt-1 text-[11px] text-ink-3">AI только находит кандидатов — выбираете вы.</div>}
          {note && <div className="mt-2 text-[12px] text-warn-strong">{note}</div>}
          {searching && !results.length && <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-3"><Spinner /> ищем…</div>}
          {results.length > 0 && (
            <div className="mt-2 max-h-56 overflow-auto rounded-fk border border-line">
              {results.map((it) => {
                const added = members.includes(it.symbol);
                return (
                  <div key={it.symbol} className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] last:border-0">
                    <span className="w-14 shrink-0 font-semibold">{it.symbol}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2" title={it.name}>{it.name}</span>
                    {it.exchange && <span className="shrink-0 text-[10px] uppercase text-ink-3">{it.exchange}</span>}
                    {it.note && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-ink-3">{it.note}</span>}
                    <button onClick={() => add(it.symbol)} disabled={added} className={`shrink-0 rounded-fk-sm border px-2 py-0.5 text-[11px] font-semibold ${added ? 'border-line text-ink-3' : 'border-brand-100 bg-brand-50 text-brand-700 hover:bg-brand-100'}`}>{added ? '✓ в составе' : '＋ добавить'}</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* управление блоком: сброс / удаление (для существующих) */}
        {(canReset || canDelete) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {canReset && (
              <Button variant="ghost" size="sm" onClick={onReset} disabled={busy}>↺ Сбросить к стандартным</Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                disabled={busy}
                className="text-down-strong hover:bg-down-soft"
                title={isCustom ? 'Удалить корзину безвозвратно' : 'Скрыть корзину (можно вернуть из «Скрытые блоки»)'}
              >
                🗑 Удалить корзину
              </Button>
            )}
            {canDelete && !isCustom && <span className="text-[11px] text-ink-3">встроенную можно вернуть из «Скрытые блоки»</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}

type CSeries = { sym: string; color: string; vals: number[]; emphasis?: boolean };

// Линия Σ (equal-weight): среднее нормализованных рядов по каждой точке.
function avgSeries(series: CSeries[], label = 'Σ'): CSeries | null {
  const real = series.filter((s) => s.vals.length);
  if (real.length < 2) return null;
  const n = Math.min(...real.map((s) => s.vals.length));
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let k = 0;
    for (const s of real) {
      const v = s.vals[i];
      if (v != null && isFinite(v)) { sum += v; k++; }
    }
    vals.push(k ? sum / k : 0);
  }
  return { sym: label, color: '#0f1729', vals, emphasis: true };
}

function periodCutoffISO(period: string): string {
  const days = COMPARE_PERIODS.find((p) => p.label === period)?.days ?? 370;
  const d = new Date();
  if (days < 0) return d.getUTCFullYear() + '-01-01';
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildCompareSeries(symbols: string[], instrMap: Map<string, { title: string; metrics: InstrumentMetrics | null }>, period: string): { dates: string[]; series: CSeries[] } {
  let refDates: string[] = [];
  for (const s of symbols) {
    const t = instrMap.get(s)?.metrics?.sparkT ?? [];
    if (t.length > refDates.length) refDates = t;
  }
  if (refDates.length < 2) return { dates: [], series: [] };
  const cutoff = periodCutoffISO(period);
  let start = refDates.findIndex((d) => d >= cutoff);
  if (start < 0) start = 0;
  const visLen = Math.max(2, refDates.length - start);
  const dates = refDates.slice(-visLen);
  const series: CSeries[] = [];
  for (const sym of symbols) {
    const mtr = instrMap.get(sym)?.metrics;
    if (!mtr || mtr.spark.length < 2) continue;
    const sp = mtr.spark.slice(-visLen);
    const base = sp[0] || 1;
    series.push({ sym, color: colorFor(sym), vals: sp.map((p) => (p / base - 1) * 100) });
  }
  return { dates, series };
}

function MultiLineChart({ dates, series }: { dates: string[]; series: CSeries[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(820);
  const [hov, setHov] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const u = () => setW(el.clientWidth || 820);
    u();
    const ro = new ResizeObserver(u);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 320, padL = 8, padR = 64, padT = 12, padB = 22;
  const n = dates.length;
  if (!series.length || n < 2) return <div ref={ref} className="flex h-[260px] items-center justify-center text-[12px] text-ink-3">Добавьте тикеры для сравнения</div>;
  let lo = Infinity, mx = -Infinity;
  for (const s of series) for (const v of s.vals) { if (v < lo) lo = v; if (v > mx) mx = v; }
  if (!isFinite(lo)) { lo = -1; mx = 1; }
  if (lo === mx) { lo -= 1; mx += 1; }
  const pad = (mx - lo) * 0.08; lo -= pad; mx += pad;
  const plotW = w - padL - padR, plotH = H - padT - padB;
  const X = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const Y = (v: number) => padT + plotH - ((v - lo) / (mx - lo)) * plotH;
  const niceStep = (r: number) => { const raw = r / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), nn = raw / mag, s = nn >= 5 ? 5 : nn >= 2 ? 2 : 1; return s * mag; };
  const step = niceStep(mx - lo);
  const grid: number[] = [];
  for (let g = Math.ceil(lo / step) * step; g <= mx; g += step) grid.push(g);
  const onMove = (e: any) => setHov(Math.max(0, Math.min(n - 1, Math.round(((e.nativeEvent.offsetX - padL) / (plotW || 1)) * (n - 1)))));
  const ends = series.map((s) => ({ sym: s.sym, color: s.color, v: s.vals[s.vals.length - 1], y: Y(s.vals[s.vals.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  const mon = (d: string) => { const t = new Date(d + 'T00:00:00'); return isNaN(t.getTime()) ? '' : t.toLocaleDateString('ru-RU', { month: 'short' }); };
  const tk = Math.min(7, n);
  const xticks: number[] = [];
  for (let t = 0; t < tk; t++) xticks.push(Math.round((t / (tk - 1)) * (n - 1)));
  const tipLeft = hov == null ? 0 : Math.max(4, Math.min(w - 150, X(hov) + 8));
  return (
    <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHov(null)}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
        {grid.map((g, k) => {
          const zero = Math.abs(g) < 1e-9;
          return (
            <g key={k}>
              <line x1={padL} x2={padL + plotW} y1={Y(g).toFixed(1)} y2={Y(g).toFixed(1)} stroke={zero ? '#c7cfdd' : '#eef1f6'} strokeDasharray={zero ? '3 3' : undefined} />
              <text x={padL + plotW + 6} y={(Y(g) + 3).toFixed(1)} fontSize="9.5" fill="#8b95a7">{(g > 0 ? '+' : '') + g.toFixed(0)}%</text>
            </g>
          );
        })}
        {xticks.map((i, k) => <text key={k} x={X(i).toFixed(1)} y={H - 6} fontSize="9.5" fill="#8b95a7" textAnchor="middle">{mon(dates[i])}</text>)}
        {series.map((s) => <path key={s.sym} d={s.vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 3 : 1.6} strokeDasharray={s.emphasis ? '6 3' : undefined} strokeLinejoin="round" />)}
        {hov != null && <line x1={X(hov).toFixed(1)} x2={X(hov).toFixed(1)} y1={padT} y2={padT + plotH} stroke="var(--fk-line-strong)" />}
        {hov != null && series.map((s) => <circle key={s.sym} cx={X(hov).toFixed(1)} cy={Y(s.vals[hov]).toFixed(1)} r={3} fill={s.color} stroke="#fff" strokeWidth={1.3} />)}
        {ends.map((e) => (
          <g key={e.sym}>
            <rect x={padL + plotW + 2} y={(e.y - 8).toFixed(1)} width={60} height={16} rx={4} fill={e.color} />
            <text x={padL + plotW + 6} y={(e.y + 3.5).toFixed(1)} fontSize="9.5" fontWeight="700" fill="#fff">{e.sym} {(e.v > 0 ? '+' : '') + e.v.toFixed(1)}</text>
          </g>
        ))}
      </svg>
      {hov != null && (
        <div className="pointer-events-none absolute top-2 rounded-fk-sm border border-line bg-surface-elev px-2 py-1.5 text-[11px] shadow-fk" style={{ left: tipLeft, minWidth: 120 }}>
          <div className="mb-1 text-ink-3">{(() => { const t = new Date((dates[hov] || '') + 'T00:00:00'); return isNaN(t.getTime()) ? dates[hov] : t.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' }); })()}</div>
          {series.map((s) => (
            <div key={s.sym} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-fk-pill" style={{ background: s.color }} />
              <span className="font-semibold">{s.sym}</span>
              <span className={`ml-auto tabular-nums ${s.vals[hov] >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>{(s.vals[hov] > 0 ? '+' : '') + s.vals[hov].toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NormalizedPerformance({ instrMap, groups, symbols, period, showAvg, onChange, onToggleAvg }: {
  instrMap: Map<string, { title: string; metrics: InstrumentMetrics | null }>;
  groups: Grp[];
  symbols: string[];
  period: string;
  showAvg: boolean;
  onChange: (symbols: string[], period: string) => void;
  onToggleAvg: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { dates, series } = buildCompareSeries(symbols, instrMap, period);
  const remove = (s: string) => onChange(symbols.filter((x) => x !== s), period);
  const toggle = (s: string) => onChange(symbols.includes(s) ? symbols.filter((x) => x !== s) : [...symbols, s].slice(0, 10), period);
  const periodVal = COMPARE_PERIODS.some((p) => p.label === period) ? period : '1Г';
  const avg = showAvg ? avgSeries(series) : null;
  const chartSeries = avg ? [...series, avg] : series;
  return (
    <div className="mb-3.5 rounded-fk border border-line bg-surface-elev shadow-fk-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold text-ink">Нормализованный перформанс</span>
          <Badge variant="brand">избранное · ребейз к 0%</Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`rounded-fk-sm border px-2.5 py-1 text-[11px] font-semibold ${showAvg ? 'border-brand-100 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-2'}`}
            onClick={onToggleAvg}
            title="Линия Σ — equal-weight среднее выбранных инструментов (доходность корзины)"
          >
            Σ среднее
          </button>
          <SegmentedControl size="sm" value={periodVal} onChange={(p) => onChange(symbols, p)} options={COMPARE_PERIODS.map((p) => ({ label: p.label, value: p.label }))} />
          <button className={`rounded-fk-sm border px-2.5 py-1 text-[11px] font-semibold ${editing ? 'border-brand-100 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-2'}`} onClick={() => setEditing((v) => !v)}>{editing ? '✓ готово' : '✎ тикеры'}</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
        {series.map((s) => {
          const last = s.vals[s.vals.length - 1];
          return (
            <span key={s.sym} className="inline-flex items-center gap-1.5 rounded-fk-pill border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-[12px] font-semibold">
              <span className="h-2.5 w-2.5 rounded-fk-pill" style={{ background: s.color }} />{s.sym}
              <span className={`tabular-nums ${last >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>{(last > 0 ? '+' : '') + last.toFixed(1)}%</span>
              <span className="cursor-pointer rounded px-1 text-ink-3 hover:bg-line hover:text-down-strong" onClick={() => remove(s.sym)}>✕</span>
            </span>
          );
        })}
        {avg && (
          <span className="inline-flex items-center gap-1.5 rounded-fk-pill border border-ink bg-surface-2 py-1 px-2.5 text-[12px] font-bold" title="equal-weight среднее (доходность корзины)">
            <span className="h-2.5 w-2.5 rounded-fk-pill" style={{ background: avg.color }} />Σ корзина
            <span className={`tabular-nums ${avg.vals[avg.vals.length - 1] >= 0 ? 'text-up-strong' : 'text-down-strong'}`}>{(avg.vals[avg.vals.length - 1] > 0 ? '+' : '') + avg.vals[avg.vals.length - 1].toFixed(1)}%</span>
          </span>
        )}
        {series.length === 0 && <span className="text-[12px] text-ink-3">Добавьте тикеры через «✎ тикеры»</span>}
      </div>
      {editing && <div className="mt-3"><TickerPicker groups={groups} selected={new Set(symbols)} onToggle={toggle} /></div>}
      <div className="px-3.5 py-3">
        <MultiLineChart dates={dates} series={chartSeries} />
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
  isFav,
  onToggleFav,
  onAddCompare,
  onClose,
}: {
  sel: { block: OverviewBlock; m: InstrumentMetrics; title: string };
  spy: InstrumentMetrics | null;
  isFav: boolean;
  onToggleFav: () => void;
  onAddCompare: () => void;
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
            <button onClick={onAddCompare} className="rounded-fk-sm border border-line-strong bg-surface-elev px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-surface-2">＋ в сравнение</button>
            <button
              onClick={onToggleFav}
              className={`rounded-fk-sm border px-3 py-1.5 text-[12px] font-semibold ${isFav ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-line-strong bg-surface-elev text-ink hover:bg-surface-2'}`}
              style={isFav ? { borderColor: '#fde68a', background: '#fffbeb', color: '#b45309' } : undefined}
            >
              {isFav ? '★ в избранном' : '☆ в избранное'}
            </button>
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
