'use client';

// Скринер (боевая версия, MVP): вселенная → конструктор условий (блоки ИЛИ, внутри И/НЕ) → таблица
// по тикерам/годам → провал в сделки. Сервер отдаёт ПАНЕЛЬ СДЕЛОК один раз (на смену вселенной/горизонта),
// условия/разрезы/провал считаются МГНОВЕННО на клиенте (src/lib/signals/screen.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, CardContent, Textarea } from '@/components/ui';
import {
  screenByTicker, screenByYear, screenDeals, totalConds,
  type ScreenPanel, type Block, type Cmp,
} from '@/lib/signals/screen';

const GROUPS: Record<string, string[]> = {
  'Секторные ETF': ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'],
  'Страновые ETF': ['EWJ', 'EWG', 'EWU', 'EWZ', 'INDA', 'EWA', 'EWC', 'FXI', 'EWY', 'EWT'],
  'Сырьё': ['GLD', 'SLV', 'USO', 'UNG', 'DBA', 'DBB', 'DBC', 'PALL', 'PPLT', 'CORN'],
  'Металлы': ['GLD', 'SLV', 'PPLT', 'PALL', 'CPER', 'URA', 'URNM', 'GDX', 'SIL'],
  'Темы': ['SMH', 'SOXX', 'ARKK', 'ICLN', 'TAN', 'LIT', 'URA', 'BOTZ', 'HACK', 'SKYY'],
  'Крупные акции': ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'XOM'],
};

const METRICS: Record<string, { label: string; periods: number[]; unit: string }> = {
  momentum: { label: 'Моментум', periods: [21, 63, 126, 252], unit: '%' },
  vol: { label: 'Волатильность', periods: [21, 63], unit: '%' },
  dist_ath: { label: 'Расст. от ATH', periods: [0], unit: '%' },
  xbench: { label: 'Превышение бенч.', periods: [63], unit: 'пп' },
  sma_dist: { label: 'Откл. от SMA', periods: [50, 200], unit: '%' },
  rsi: { label: 'RSI', periods: [14], unit: '' },
};
const MID = Object.keys(METRICS);
const colOf = (id: string, p: number) => `${id}_${p}`;
const mlabel = (id: string, p: number) => METRICS[id].label + (METRICS[id].periods.length > 1 ? ` ${p}` : '');

type UCond = { id: string; p: number; cmp: Cmp; val: number; not: boolean };
type UBlock = { conds: UCond[] };
type Disp = { id: string; p: number };

const HORIZONS = [5, 10, 21, 63];

function toBlocks(blocks: UBlock[]): Block[] {
  return blocks.map((b) => ({ conds: b.conds.map((c) => ({ col: colOf(c.id, c.p), cmp: c.cmp, val: c.val, not: c.not })) }));
}
const cls = (v: number | null) => (v == null ? 'text-ink-3' : v > 0 ? 'text-up-strong' : v < 0 ? 'text-down-strong' : 'text-ink-3');
const fnum = (v: number | null, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));

export default function Researcher() {
  const [group, setGroup] = useState('Сырьё');
  const [uniText, setUniText] = useState(GROUPS['Сырьё'].join(', '));
  const [horizon, setHorizon] = useState(21);
  const [blocks, setBlocks] = useState<UBlock[]>([
    { conds: [{ id: 'momentum', p: 63, cmp: 'ge', val: 10, not: false }, { id: 'vol', p: 21, cmp: 'le', val: 30, not: false }] },
  ]);
  const [display, setDisplay] = useState<Disp[]>([{ id: 'momentum', p: 63 }, { id: 'vol', p: 21 }, { id: 'rsi', p: 14 }]);
  const [view, setView] = useState<'tickers' | 'years'>('tickers');
  const [panel, setPanel] = useState<ScreenPanel | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [drill, setDrill] = useState<{ kind: 't' | 'y'; kv: string } | null>(null);

  const universe = useMemo(
    () => [...new Set(uniText.toUpperCase().split(/[^A-Z0-9.\-]+/).filter(Boolean))].slice(0, 40),
    [uniText],
  );

  const fetchPanel = useCallback(async (uni: string[], hz: number) => {
    if (uni.length < 1) { setPanel(null); return; }
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/signals/study', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'screen', universe: uni, benchmark: 'SPY', horizon: hz }),
      });
      if (!res.body) throw new Error('Нет потока ответа');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', out: any = null, e = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: any; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'result') out = ev.data; else if (ev.type === 'error') e = ev.text || 'ошибка';
        }
      }
      if (e) throw new Error(e);
      setPanel(out && out.mode === 'screen' ? out : null);
    } catch (ex: any) {
      setErr(ex?.message || 'ошибка'); setPanel(null);
    } finally { setLoading(false); }
  }, []);

  // авто-загрузка панели на смену вселенной/горизонта (с дебаунсом)
  const t = useRef<any>(null);
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => fetchPanel(universe, horizon), 350);
    return () => clearTimeout(t.current);
  }, [universe.join(','), horizon, fetchPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  const blk = toBlocks(blocks);
  const displayCols = display.map((d) => colOf(d.id, d.p));
  const byT = useMemo(() => (panel ? screenByTicker(panel, blk, displayCols) : []), [panel, blocks, display]); // eslint-disable-line react-hooks/exhaustive-deps
  const byY = useMemo(() => (panel ? screenByYear(panel, blk) : []), [panel, blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchedN = byY.reduce((a, y) => a + y.n, 0);

  // ── helpers UI ──
  const setBlocks2 = (f: (b: UBlock[]) => UBlock[]) => setBlocks((prev) => f(structuredClone(prev)));

  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-ink">Скринер</h1>
        <Badge variant="brand">боевая версия · MVP</Badge>
        <span className="text-[12px] text-ink-3">Вселенная → условия (блоки ИЛИ, внутри И/НЕ) → таблица (тикеры/годы) → провал в сделки. Пересчёт мгновенный на клиенте.</span>
      </div>

      {/* 1. Вселенная */}
      <Card className="mb-3.5">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">1 · Вселенная</span>
            <span className="text-[12px] text-ink-3">{universe.length} тикеров{loading ? ' · загрузка…' : ''}</span>
          </div>
          <div className="mb-2.5 flex flex-wrap gap-2">
            {Object.keys(GROUPS).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => { setGroup(g); setUniText(GROUPS[g].join(', ')); }}
                className={`rounded-fk-pill border px-3 py-1.5 text-[12px] font-semibold transition-colors ${group === g ? 'border-brand-100 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-2 hover:bg-surface-2'}`}
              >
                {g}<span className="ml-1.5 text-[10.5px] font-normal text-ink-3">{GROUPS[g].length}</span>
              </button>
            ))}
          </div>
          <Textarea value={uniText} onChange={(e: any) => { setUniText(e.target.value); setGroup(''); }} rows={2} className="font-mono text-[12.5px]" spellCheck={false} />
          <p className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-3">
            <span>Пресет — стартовый набор; список правится свободно (до 40).</span>
            <span className="ml-auto flex items-center gap-1.5">Горизонт форварда:
              {HORIZONS.map((h) => (
                <button key={h} type="button" onClick={() => setHorizon(h)} className={`rounded-fk-sm px-2 py-0.5 text-[11px] font-semibold ${horizon === h ? 'bg-brand-50 text-brand-700' : 'bg-surface-2 text-ink-3'}`}>{h}д</button>
              ))}
            </span>
          </p>
          {err && <p className="mt-1.5 text-[12px] font-medium text-down-strong">Ошибка: {err}</p>}
        </CardContent>
      </Card>

      {/* 2. Условия */}
      <Card className="mb-3.5">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">2 · Условия отбора</span>
            <span className="text-[12px] text-ink-3">блоки = <b className="text-brand-700">ИЛИ</b> · внутри блока — <b>И</b> / <b className="text-down-strong">НЕ</b></span>
          </div>
          <div className="flex flex-col">
            {blocks.map((b, bi) => (
              <div key={bi}>
                {bi > 0 && (
                  <div className="my-2.5 flex items-center gap-2.5">
                    <span className="h-px flex-1 bg-line" />
                    <span className="rounded-fk-pill border border-brand-100 bg-brand-50 px-3 py-0.5 text-[11px] font-bold text-brand-700">ИЛИ</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div className="rounded-fk border border-line-strong bg-surface-2 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ink-2">Блок {bi + 1}</span>
                    <button type="button" className="text-[12px] text-ink-3 hover:text-down-strong" onClick={() => setBlocks2((bb) => { bb.splice(bi, 1); if (!bb.length) bb.push({ conds: [] }); return bb; })}>удалить блок</button>
                  </div>
                  {b.conds.map((c, ci) => (
                    <div key={ci} className="mt-1.5 grid grid-cols-[56px_1.3fr_78px_62px_76px_24px] items-center gap-2 rounded-fk-sm border border-line bg-surface-elev px-2 py-1.5">
                      <button type="button" onClick={() => setBlocks2((bb) => { bb[bi].conds[ci].not = !bb[bi].conds[ci].not; return bb; })}
                        className={`rounded-fk-sm border py-1 text-[11px] font-bold ${c.not ? 'border-transparent bg-down-soft text-down-strong' : 'border-line-strong bg-surface-elev text-ink-3'}`}>{c.not ? 'НЕ' : 'И'}</button>
                      <select className="w-full rounded-fk-sm border border-line-strong bg-white px-1.5 py-1 text-[12px]" value={c.id}
                        onChange={(e) => setBlocks2((bb) => { const id = e.target.value; bb[bi].conds[ci].id = id; if (!METRICS[id].periods.includes(bb[bi].conds[ci].p)) bb[bi].conds[ci].p = METRICS[id].periods[0]; return bb; })}>
                        {MID.map((id) => <option key={id} value={id}>{METRICS[id].label}</option>)}
                      </select>
                      <select className="w-full rounded-fk-sm border border-line-strong bg-white px-1.5 py-1 text-[12px] disabled:opacity-50" value={c.p} disabled={METRICS[c.id].periods.length < 2}
                        onChange={(e) => setBlocks2((bb) => { bb[bi].conds[ci].p = +e.target.value; return bb; })}>
                        {METRICS[c.id].periods.map((p) => <option key={p} value={p}>{p === 0 ? 'всё' : `${p}д`}</option>)}
                      </select>
                      <div className="flex gap-0.5 rounded-fk-sm bg-surface-2 p-0.5">
                        {(['ge', 'le'] as Cmp[]).map((cm) => (
                          <button key={cm} type="button" onClick={() => setBlocks2((bb) => { bb[bi].conds[ci].cmp = cm; return bb; })}
                            className={`flex-1 rounded-fk-sm py-1 text-[12px] font-semibold ${c.cmp === cm ? 'bg-white text-ink shadow-fk-sm' : 'text-ink-3'}`}>{cm === 'ge' ? '≥' : '≤'}</button>
                        ))}
                      </div>
                      <input className="w-full rounded-fk-sm border border-line-strong bg-white px-1.5 py-1 text-right text-[12px] tabular-nums" defaultValue={c.val} inputMode="decimal"
                        onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) setBlocks2((bb) => { bb[bi].conds[ci].val = n; return bb; }); }} />
                      <button type="button" className="text-ink-3 hover:text-down-strong" onClick={() => setBlocks2((bb) => { bb[bi].conds.splice(ci, 1); return bb; })}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="mt-2 rounded-fk-sm border border-dashed border-line-strong px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 hover:bg-surface-2"
                    onClick={() => setBlocks2((bb) => { bb[bi].conds.push({ id: 'momentum', p: 63, cmp: 'ge', val: 10, not: false }); return bb; })}>+ И условие</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="mt-3 rounded-fk border border-dashed border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-surface-2"
            onClick={() => setBlocks((p) => [...p, { conds: [{ id: 'rsi', p: 14, cmp: 'le', val: 35, not: false }] }])}>+ ИЛИ — новый блок</button>
        </CardContent>
      </Card>

      {/* 3. Метрики в таблице */}
      <Card className="mb-3.5">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">3 · Метрики в таблице</span>
            <span className="text-[12px] text-ink-3">любые для показа, даже если не в условиях</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {MID.flatMap((id) => METRICS[id].periods.map((p) => ({ id, p }))).map((o) => {
              const on = display.some((d) => d.id === o.id && d.p === o.p);
              return (
                <button key={`${o.id}_${o.p}`} type="button"
                  onClick={() => setDisplay((d) => on ? d.filter((x) => !(x.id === o.id && x.p === o.p)) : [...d, o])}
                  className={`rounded-fk-pill border px-3 py-1 text-[11.5px] font-semibold ${on ? 'border-line bg-surface-2 text-ink' : 'border-dashed border-line-strong text-ink-3'}`}>
                  {mlabel(o.id, o.p)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 4. Результаты */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">4 · Результаты</span>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-ink-2">{!panel ? '' : totalConds(blk) ? `${matchedN} сделок прошли · ${byT.length} тикеров` : `все сделки (${matchedN})`}</span>
              <div className="flex gap-0.5 rounded-fk bg-surface-2 p-0.5">
                {(['tickers', 'years'] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setView(v)} className={`rounded-fk-sm px-3 py-1 text-[12px] font-semibold ${view === v ? 'bg-surface-elev text-ink shadow-fk-sm' : 'text-ink-3'}`}>{v === 'tickers' ? 'По тикерам' : 'По годам'}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            {!panel ? (
              <p className="py-10 text-center text-[13px] text-ink-3">{loading ? 'Загружаю панель сделок…' : 'Выберите вселенную.'}</p>
            ) : view === 'tickers' ? (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10px] uppercase text-ink-3">
                    <th className="p-2 text-left">Тикер</th><th className="p-2 text-right">Сделок</th>
                    {display.map((o) => <th key={`${o.id}_${o.p}`} className="p-2 text-right">{mlabel(o.id, o.p)}</th>)}
                    <th className="p-2 text-right">Доля +</th><th className="p-2 text-right">Ср. форвард</th>
                  </tr>
                </thead>
                <tbody>
                  {byT.map((r) => (
                    <tr key={r.symbol} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setDrill({ kind: 't', kv: r.symbol })}>
                      <td className="p-2 text-left font-bold text-ink">{r.symbol}</td>
                      <td className="p-2 text-right tabular-nums">{r.n}</td>
                      {r.disp.map((v, i) => <td key={i} className={`p-2 text-right tabular-nums ${cls(v)}`}>{v == null ? '—' : display[i].id === 'rsi' ? v.toFixed(0) : fnum(v)}</td>)}
                      <td className="p-2 text-right tabular-nums">{r.hitPct.toFixed(0)}%</td>
                      <td className={`p-2 text-right font-semibold tabular-nums ${cls(r.avgFwd)}`}>{fnum(r.avgFwd)}</td>
                    </tr>
                  ))}
                  {!byT.length && <tr><td colSpan={9} className="p-5 text-center text-ink-3">Ничего не прошло условия — ослабьте блоки.</td></tr>}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-[10px] uppercase text-ink-3"><th className="p-2 text-left">Год</th><th className="p-2 text-right">Сделок</th><th className="p-2 text-right">Тикеров</th><th className="p-2 text-right">Доля +</th><th className="p-2 text-right">Ср. форвард</th></tr></thead>
                <tbody>
                  {byY.map((y) => (
                    <tr key={y.year} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setDrill({ kind: 'y', kv: String(y.year) })}>
                      <td className="p-2 text-left font-bold text-ink">{y.year}</td>
                      <td className="p-2 text-right tabular-nums">{y.n}</td><td className="p-2 text-right tabular-nums">{y.tickers}</td>
                      <td className="p-2 text-right tabular-nums">{y.hitPct.toFixed(0)}%</td>
                      <td className={`p-2 text-right font-semibold tabular-nums ${cls(y.avgFwd)}`}>{fnum(y.avgFwd)}</td>
                    </tr>
                  ))}
                  {!byY.length && <tr><td colSpan={5} className="p-5 text-center text-ink-3">Нет сделок.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          {panel && <p className="mt-2 text-[11px] text-ink-3">Клик по строке → провал внутрь сделок. Панель: {panel.meta?.obs} сделок, {panel.symbols.length} тикеров, {panel.meta?.first} … {panel.meta?.last} (форвард {panel.horizon}д vs SPY).</p>}
        </CardContent>
      </Card>

      {drill && panel && <DrillDrawer panel={panel} blocks={blk} drill={drill} onClose={() => setDrill(null)} />}
    </main>
  );
}

function DrillDrawer({ panel, blocks, drill, onClose }: { panel: ScreenPanel; blocks: Block[]; drill: { kind: 't' | 'y'; kv: string }; onClose: () => void }) {
  const deals = screenDeals(panel, blocks, drill.kind, drill.kv);
  const avg = deals.length ? deals.reduce((a, d) => a + d.fwd, 0) / deals.length : 0;
  const hit = deals.length ? (deals.filter((d) => d.fwd > 0).length / deals.length) * 100 : 0;
  const tickers = new Set(deals.map((d) => d.symbol)).size;
  return (
    <>
      <div className="fixed inset-0 z-50 bg-[rgba(15,23,41,0.34)]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-[min(640px,94vw)] flex-col bg-surface-elev shadow-fk-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="text-[15px] font-bold text-ink">{drill.kind === 't' ? `${drill.kv} · сделки` : `Год ${drill.kv} · сделки`}</div>
            <div className="text-[11px] text-ink-3">матч-сделки по текущим условиям</div>
          </div>
          <button type="button" className="text-ink-3 hover:text-ink" onClick={onClose}>✕</button>
        </div>
        <div className="overflow-auto px-5 py-4">
          <div className="mb-3 grid grid-cols-4 gap-2">
            {[['Сделок', String(deals.length)], ['Ср. форвард', fnum(avg) + '%'], ['Доля +', hit.toFixed(0) + '%'], ['Тикеров', String(tickers)]].map(([k, v]) => (
              <div key={k} className="rounded-fk bg-surface-2 px-2.5 py-2"><div className="text-[10px] uppercase text-ink-3">{k}</div><div className="mt-0.5 text-[15px] font-bold text-ink">{v}</div></div>
            ))}
          </div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-[10px] uppercase text-ink-3"><th className="p-1.5 text-left">Дата</th>{drill.kind === 'y' && <th className="p-1.5 text-left">Тикер</th>}<th className="p-1.5 text-right">Момент. 63</th><th className="p-1.5 text-right">Вола 21</th><th className="p-1.5 text-right">RSI</th><th className="p-1.5 text-right">Форвард</th></tr></thead>
            <tbody>
              {deals.map((d, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="p-1.5 text-left tabular-nums">{d.date}</td>
                  {drill.kind === 'y' && <td className="p-1.5 text-left font-bold">{d.symbol}</td>}
                  <td className={`p-1.5 text-right tabular-nums ${cls(d.vals.momentum_63)}`}>{fnum(d.vals.momentum_63)}</td>
                  <td className="p-1.5 text-right tabular-nums">{d.vals.vol_21 ?? '—'}</td>
                  <td className="p-1.5 text-right tabular-nums">{d.vals.rsi_14 ?? '—'}</td>
                  <td className={`p-1.5 text-right font-semibold tabular-nums ${cls(d.fwd)}`}>{fnum(d.fwd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
