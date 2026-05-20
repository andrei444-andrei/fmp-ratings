'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// ---- типы ответа API ----
type Stats = {
  latest: { date: string; value: number } | null;
  prev: { date: string; value: number } | null;
  zscore: number | null;
  yoyPct: number | null;
  changePct: number | null;
  level: 'green' | 'amber' | 'red' | 'na';
  windowN: number;
  sparkline: number[];
};
type SeriesRow = {
  id: string;
  source: string;
  segment: string;
  segmentLabel: string;
  label: string;
  unit: string | null;
  metric: string;
  frequency: string;
  lagNote: string | null;
  indexSymbol: string | null;
  higherIsRisk: boolean;
  updatedAt: string | null;
  count: number;
  stats: Stats;
};
type Composite = {
  value: number | null;
  bySegment: Record<string, number | null>;
  level: 'green' | 'amber' | 'red' | 'na';
};
type Overview = { series: SeriesRow[]; composite: Composite; segments: Record<string, { label: string; items: string[] }> };

type Obs = { date: string; value: number };
type Detail = {
  id: string; label: string; unit: string | null; metric: string; segment: string;
  frequency: string; lagNote: string | null; indexSymbol: string | null; higherIsRisk: boolean;
  stats: Stats; observations: Obs[];
};

const LEVEL_COLOR: Record<string, string> = {
  green: '#16a34a', amber: '#d97706', red: '#dc2626', na: '#9ca3af',
};
const LEVEL_LABEL: Record<string, string> = {
  green: 'норма', amber: 'повышено', red: 'аномалия', na: 'нет данных',
};

const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits });
const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const fmtZ = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2);

// ---- мини-спарклайн ----
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <span className="text-xs text-neutral-400">—</span>;
  const w = 120, h = 28, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

// ---- линейный график (одна или две нормализованные линии) ----
function LineChart({
  primary, overlay, primaryLabel, overlayLabel,
}: {
  primary: Obs[]; overlay?: Obs[]; primaryLabel: string; overlayLabel?: string;
}) {
  const w = 760, h = 280, padL = 8, padR = 8, padT = 14, padB = 22;
  if (!primary.length) return <div className="text-sm text-neutral-500">нет данных</div>;

  const dates = primary.map(o => o.date);
  const t0 = new Date(dates[0]).getTime();
  const t1 = new Date(dates[dates.length - 1]).getTime();
  const tSpan = t1 - t0 || 1;
  const xOf = (d: string) => padL + ((new Date(d).getTime() - t0) / tSpan) * (w - padL - padR);

  function pathFor(data: Obs[], color: string) {
    const ys = data.map(o => o.value);
    const min = Math.min(...ys), max = Math.max(...ys);
    const span = max - min || 1;
    const yOf = (v: number) => padT + (1 - (v - min) / span) * (h - padT - padB);
    const d = data
      .filter(o => o.date >= dates[0] && o.date <= dates[dates.length - 1])
      .map((o, i) => `${i === 0 ? 'M' : 'L'}${xOf(o.date).toFixed(1)},${yOf(o.value).toFixed(1)}`)
      .join(' ');
    return { d, color, min, max };
  }

  const p = pathFor(primary, '#2563eb');
  const ov = overlay && overlay.length ? pathFor(overlay, '#9ca3af') : null;

  // подписи годов по оси X
  const ticks: { x: number; label: string }[] = [];
  const startYr = new Date(dates[0]).getFullYear();
  const endYr = new Date(dates[dates.length - 1]).getFullYear();
  const stepYr = Math.max(1, Math.ceil((endYr - startYr) / 8));
  for (let y = startYr; y <= endYr; y += stepYr) {
    ticks.push({ x: xOf(`${y}-01-01`), label: String(y) });
  }

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="block max-w-full">
        <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} stroke="#e5e7eb" />
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={tk.x} y1={padT} x2={tk.x} y2={h - padB} stroke="#f3f4f6" />
            <text x={tk.x} y={h - 6} fontSize={10} fill="#9ca3af" textAnchor="middle">{tk.label}</text>
          </g>
        ))}
        {ov && <path d={ov.d} fill="none" stroke={ov.color} strokeWidth={1.3} strokeDasharray="4 3" />}
        <path d={p.d} fill="none" stroke={p.color} strokeWidth={1.8} />
      </svg>
      <div className="flex gap-4 text-xs mt-1">
        <span className="flex items-center gap-1"><span style={{ background: '#2563eb' }} className="inline-block w-3 h-0.5" /> {primaryLabel}</span>
        {ov && overlayLabel && (
          <span className="flex items-center gap-1"><span style={{ background: '#9ca3af' }} className="inline-block w-3 h-0.5" /> {overlayLabel} (форма)</span>
        )}
      </div>
    </div>
  );
}

// ---- клиентские трансформации ряда для переключателя видов ----
function transform(obs: Obs[], view: 'abs' | 'yoy' | 'z', freq: string): Obs[] {
  if (view === 'abs') return obs;
  if (view === 'yoy') {
    const out: Obs[] = [];
    for (let i = 0; i < obs.length; i++) {
      const target = new Date(obs[i].date);
      target.setFullYear(target.getFullYear() - 1);
      const tt = target.getTime();
      let best: Obs | null = null, bd = Infinity;
      for (let j = 0; j <= i; j++) {
        const diff = Math.abs(new Date(obs[j].date).getTime() - tt);
        if (diff < bd) { bd = diff; best = obs[j]; }
      }
      if (best && bd <= 45 * 864e5 && Math.abs(best.value) > 1e-9) {
        out.push({ date: obs[i].date, value: (obs[i].value - best.value) / Math.abs(best.value) * 100 });
      }
    }
    return out;
  }
  // rolling z-score
  const win = freq === 'daily' ? 5 * 252 : freq === 'weekly' ? 5 * 52 : freq === 'monthly' ? 60 : 20;
  const out: Obs[] = [];
  for (let i = 0; i < obs.length; i++) {
    const slice = obs.slice(Math.max(0, i - win + 1), i + 1).map(o => o.value);
    if (slice.length < 4) continue;
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
    if (sd < 1e-9) continue;
    out.push({ date: obs[i].date, value: (obs[i].value - mean) / sd });
  }
  return out;
}

export default function LeveragePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ETL
  const [busy, setBusy] = useState<string | null>(null);
  const [ingestLog, setIngestLog] = useState<string[]>([]);
  const [finraCsv, setFinraCsv] = useState('');
  const log = (m: string) => setIngestLog(prev => [`[${new Date().toLocaleTimeString()}] ${m}`, ...prev].slice(0, 50));

  // drill-down
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [view, setView] = useState<'abs' | 'yoy' | 'z'>('abs');
  const [overlay, setOverlay] = useState<Obs[]>([]);

  const loadOverview = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/leverage/overview').then(r => r.json());
      if (r.error) setError(r.error);
      else setData(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  async function migrate() {
    setBusy('migrate');
    try {
      const r = await fetch('/api/admin/migrate', { method: 'POST' }).then(r => r.json());
      log(r.ok ? `Миграция ок (${r.executed} стейтментов)` : `Миграция: ошибки ${r.failed ?? '?'}`);
    } catch (e: any) { log(`Миграция: ${e.message}`); }
    finally { setBusy(null); }
  }

  async function ingest(source: 'fred' | 'cftc' | 'finra', useCsv = false) {
    setBusy(source);
    try {
      const body: any = { source };
      if (source === 'finra' && useCsv) body.csv = finraCsv;
      const r = await fetch('/api/leverage/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => r.json());
      if (r.error) { log(`${source}: ${r.error}`); return; }
      if (r.sourceUrl) log(`${source}: файл ${r.sourceUrl}`);
      for (const res of r.results || []) {
        log(`${source} · ${res.label}: ${res.error ? 'ОШИБКА ' + res.error : res.rows + ' строк'}`);
      }
      await loadOverview();
    } catch (e: any) { log(`${source}: ${e.message}`); }
    finally { setBusy(null); }
  }

  // загрузка drill-down + overlay
  useEffect(() => {
    if (!selected) { setDetail(null); setOverlay([]); return; }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const d: Detail = await fetch(`/api/leverage/series/${encodeURIComponent(selected)}`).then(r => r.json());
        if (cancelled) return;
        setDetail(d);
        setOverlay([]);
        if (d.indexSymbol && d.observations.length) {
          const from = d.observations[0].date;
          const to = d.observations[d.observations.length - 1].date;
          try {
            const px = await fetch(`/api/fmp/historical-price-eod?symbol=${encodeURIComponent(d.indexSymbol)}&from=${from}&to=${to}`).then(r => r.json());
            if (!cancelled && Array.isArray(px)) {
              const ov = px
                .filter((r: any) => r && r.date && Number.isFinite(Number(r.price)))
                .map((r: any) => ({ date: String(r.date).slice(0, 10), value: Number(r.price) }))
                .sort((a: Obs, b: Obs) => a.date.localeCompare(b.date));
              setOverlay(ov);
            }
          } catch { /* overlay опционален */ }
        }
      } catch { if (!cancelled) setDetail(null); }
      finally { if (!cancelled) setDetailLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  const transformed = useMemo(() => {
    if (!detail) return [];
    return transform(detail.observations, view, detail.frequency);
  }, [detail, view]);

  const last12 = useMemo(() => {
    if (!detail) return [];
    return detail.observations.slice(-12).reverse();
  }, [detail]);

  return (
    <main>
      <section className="card">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold">Leverage Monitor</h2>
            <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
              Термометр кредитного плеча по классам активов. Sprint 1: FINRA margin debt (US),
              FRED (broker-dealer receivables, total credit, Wilshire), CFTC COT (net positioning по фьючерсам).
              Светофор — по 5-летнему Z-score с учётом направления риска. У каждого ряда показан лаг данных.
            </p>
          </div>
          {data?.composite && (
            <div className="text-center px-4 py-2 rounded-lg border" style={{ borderColor: LEVEL_COLOR[data.composite.level] }}>
              <div className="text-xs text-neutral-500">Global Leverage Index</div>
              <div className="text-2xl font-bold" style={{ color: LEVEL_COLOR[data.composite.level] }}>
                {fmtZ(data.composite.value)}
              </div>
              <div className="text-xs" style={{ color: LEVEL_COLOR[data.composite.level] }}>{LEVEL_LABEL[data.composite.level]}</div>
            </div>
          )}
        </div>
      </section>

      {/* ETL */}
      <section className="card">
        <h3 className="font-semibold mb-2">Обновление данных (ETL)</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <button className="btn" disabled={!!busy} onClick={migrate} title="Не обязательно — таблицы создаются автоматически">
            {busy === 'migrate' ? '...' : 'Миграция таблиц (опц.)'}
          </button>
          <button className="btn-primary" disabled={!!busy} onClick={() => ingest('fred')}>
            {busy === 'fred' ? 'FRED...' : 'Загрузить FRED'}
          </button>
          <button className="btn-primary" disabled={!!busy} onClick={() => ingest('cftc')}>
            {busy === 'cftc' ? 'CFTC...' : 'Загрузить CFTC (COT)'}
          </button>
          <button className="btn-primary" disabled={!!busy} onClick={() => ingest('finra')}>
            {busy === 'finra' ? 'FINRA...' : 'Загрузить FINRA (авто)'}
          </button>
          <span className="text-xs text-neutral-500">FRED требует <code>FRED_API_KEY</code>. CFTC — публичный. FINRA качается с finra.org (xlsx).</span>
        </div>

        <details className="mt-3">
          <summary className="text-sm cursor-pointer text-neutral-700">FINRA Margin Debt — ручной импорт CSV (fallback)</summary>
          <p className="text-xs text-neutral-500 mt-1">
            Запасной вариант, если авто-загрузка не сработала. Скопируйте таблицу с finra.org (Margin Statistics) в CSV.
            Парсер ищет колонку месяца и колонки «Debit Balances …» (margin debt) и «Free Credit Balances …».
            Форматы дат: <code>2024-01</code>, <code>Jan-24</code>, <code>01/2024</code>.
          </p>
          <textarea
            className="input w-full mt-2 font-mono text-xs" rows={5}
            placeholder={'Month,Debit Balances,Free Credit Balances\n2024-01,789000,180000\n...'}
            value={finraCsv} onChange={e => setFinraCsv(e.target.value)}
          />
          <button className="btn mt-2" disabled={!!busy || !finraCsv.trim()} onClick={() => ingest('finra', true)}>
            {busy === 'finra' ? 'Импорт...' : 'Импортировать FINRA CSV'}
          </button>
        </details>

        {ingestLog.length > 0 && (
          <div className="log mt-3">{ingestLog.join('\n')}</div>
        )}
      </section>

      {error && <section className="card"><p className="text-sm text-red-600">{error}</p></section>}

      {/* Overview thermometer */}
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Overview — термометр</h3>
          <button className="btn" onClick={loadOverview} disabled={loading}>{loading ? '...' : 'Обновить'}</button>
        </div>

        {!data?.series.length && !loading && (
          <p className="text-sm text-neutral-600">
            Нет данных. Нажмите «Загрузить FRED» / «Загрузить CFTC» / «Загрузить FINRA (авто)» — таблицы создадутся автоматически.
          </p>
        )}

        {Object.entries(data?.segments ?? {}).map(([seg, info]) => {
          const rows = (data?.series ?? []).filter(s => s.segment === seg);
          const segScore = data?.composite.bySegment[seg];
          return (
            <div key={seg} className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-sm">{info.label}</h4>
                <span className="text-xs text-neutral-500">сегмент-score: {fmtZ(segScore)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-100 text-left">
                      <th className="p-2 border"></th>
                      <th className="p-2 border">Метрика</th>
                      <th className="p-2 border">12М</th>
                      <th className="p-2 border">Значение</th>
                      <th className="p-2 border">Z (5y)</th>
                      <th className="p-2 border">YoY</th>
                      <th className="p-2 border">Δ посл.</th>
                      <th className="p-2 border">Дата</th>
                      <th className="p-2 border">Лаг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(s => (
                      <tr
                        key={s.id}
                        className={`hover:bg-neutral-50 cursor-pointer ${selected === s.id ? 'bg-blue-50' : ''}`}
                        onClick={() => setSelected(s.id)}
                      >
                        <td className="p-2 border">
                          <span className="inline-block w-3 h-3 rounded-full align-middle"
                                style={{ background: LEVEL_COLOR[s.stats.level] }}
                                title={LEVEL_LABEL[s.stats.level]} />
                        </td>
                        <td className="p-2 border">{s.label}</td>
                        <td className="p-2 border"><Sparkline data={s.stats.sparkline} color={LEVEL_COLOR[s.stats.level]} /></td>
                        <td className="p-2 border font-mono whitespace-nowrap">
                          {fmtNum(s.stats.latest?.value)} <span className="text-neutral-400 text-xs">{s.unit}</span>
                        </td>
                        <td className="p-2 border font-mono" style={{ color: LEVEL_COLOR[s.stats.level] }}>{fmtZ(s.stats.zscore)}</td>
                        <td className="p-2 border font-mono">{fmtPct(s.stats.yoyPct)}</td>
                        <td className="p-2 border font-mono">{fmtPct(s.stats.changePct)}</td>
                        <td className="p-2 border text-xs whitespace-nowrap">{s.stats.latest?.date ?? '—'}</td>
                        <td className="p-2 border text-xs text-neutral-500">{s.lagNote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </section>

      {/* Drill-down */}
      {selected && (
        <section className="card">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <h3 className="font-semibold">{detail?.label ?? selected}</h3>
            <div className="flex gap-2 items-center">
              <div className="flex rounded border overflow-hidden text-sm">
                {(['abs', 'yoy', 'z'] as const).map(v => (
                  <button key={v}
                          className={`px-2 py-1 ${view === v ? 'bg-blue-600 text-white' : 'bg-white hover:bg-neutral-100'}`}
                          onClick={() => setView(v)}>
                    {v === 'abs' ? 'Абсолют' : v === 'yoy' ? 'YoY %' : 'Z-score'}
                  </button>
                ))}
              </div>
              <a className="btn" href={`/api/leverage/series/${encodeURIComponent(selected)}?format=csv`}>CSV</a>
              <button className="btn" onClick={() => setSelected(null)}>Закрыть</button>
            </div>
          </div>

          {detailLoading && <p className="text-sm text-blue-600">Загрузка...</p>}
          {detail && !detailLoading && (
            <>
              <p className="text-xs text-neutral-500 mb-2">
                {detail.metric} · {detail.frequency} · лаг {detail.lagNote ?? '—'} ·
                {' '}наблюдений: {detail.observations.length}
                {detail.indexSymbol && view === 'abs' && overlay.length ? ` · overlay: ${detail.indexSymbol}` : ''}
              </p>
              <LineChart
                primary={transformed}
                overlay={view === 'abs' ? overlay : undefined}
                primaryLabel={view === 'abs' ? (detail.unit ?? 'значение') : view === 'yoy' ? 'YoY %' : 'Z-score'}
                overlayLabel={detail.indexSymbol ?? undefined}
              />

              <h4 className="font-medium text-sm mt-4 mb-1">Последние 12 наблюдений</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-100 text-left">
                      <th className="p-2 border">Дата</th>
                      <th className="p-2 border">Значение</th>
                      <th className="p-2 border">Δ к пред.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {last12.map((o, i) => {
                      const prev = last12[i + 1];
                      const delta = prev && Math.abs(prev.value) > 1e-9 ? (o.value - prev.value) / Math.abs(prev.value) * 100 : null;
                      return (
                        <tr key={o.date} className="hover:bg-neutral-50">
                          <td className="p-2 border text-xs">{o.date}</td>
                          <td className="p-2 border font-mono">{fmtNum(o.value)} <span className="text-neutral-400 text-xs">{detail.unit}</span></td>
                          <td className={`p-2 border font-mono ${delta == null ? '' : delta > 0 ? 'text-green-700' : delta < 0 ? 'text-red-700' : ''}`}>{fmtPct(delta)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
