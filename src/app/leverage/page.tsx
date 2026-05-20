'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Obs = { date: string; value: number };
type Region = {
  code: string;
  name: string;
  color: string;
  lagNote: string | null;
  updatedAt: string | null;
  observations: Obs[];
};

const REGION_OPTIONS = [
  { code: 'KR', name: 'Южная Корея' },
  { code: 'JP', name: 'Япония' },
  { code: 'CN', name: 'Китай' },
  { code: 'EU', name: 'Еврозона' },
];

const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(2) + '%';
const tms = (d: string) => new Date(d).getTime();

// ===== Интерактивный мультилинейный график (SVG + hover-крестик + тултип) =====
function MdmcChart({ regions, visible }: { regions: Region[]; visible: Record<string, boolean> }) {
  const W = 960, H = 420, padL = 48, padR = 16, padT = 16, padB = 28;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const shown = regions.filter(r => visible[r.code] && r.observations.length);

  const scales = useMemo(() => {
    let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const r of shown) for (const o of r.observations) {
      const t = tms(o.date);
      if (t < tMin) tMin = t; if (t > tMax) tMax = t;
      if (o.value < vMin) vMin = o.value; if (o.value > vMax) vMax = o.value;
    }
    if (!Number.isFinite(tMin)) return null;
    if (tMax === tMin) tMax = tMin + 1;
    const pad = (vMax - vMin) * 0.08 || 1;
    vMin -= pad; vMax += pad;
    return { tMin, tMax, vMin, vMax };
  }, [shown]);

  if (!scales) {
    return <div className="text-sm text-neutral-500 py-12 text-center">Нет данных для графика. Загрузите США или импортируйте регион.</div>;
  }
  const { tMin, tMax, vMin, vMax } = scales;
  const xOf = (t: number) => padL + (t - tMin) / (tMax - tMin) * (W - padL - padR);
  const yOf = (v: number) => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);

  // годовые тики по X
  const xticks: { x: number; label: string }[] = [];
  const y0 = new Date(tMin).getFullYear(), y1 = new Date(tMax).getFullYear();
  const step = Math.max(1, Math.ceil((y1 - y0) / 10));
  for (let y = y0; y <= y1; y += step) xticks.push({ x: xOf(tms(`${y}-01-01`)), label: String(y) });

  // тики по Y (% )
  const yticks: number[] = [];
  const yn = 5;
  for (let i = 0; i <= yn; i++) yticks.push(vMin + (vMax - vMin) * i / yn);

  // hover: ближайшая точка каждого ряда к наведённому времени
  let hover: { x: number; items: { code: string; name: string; color: string; date: string; value: number; cy: number }[] } | null = null;
  if (hoverX != null) {
    const t = tMin + (hoverX - padL) / (W - padL - padR) * (tMax - tMin);
    const items = shown.map(r => {
      let best = r.observations[0], bd = Infinity;
      for (const o of r.observations) { const d = Math.abs(tms(o.date) - t); if (d < bd) { bd = d; best = o; } }
      return { code: r.code, name: r.name, color: r.color, date: best.date, value: best.value, cy: yOf(best.value) };
    });
    hover = { x: hoverX, items };
  }

  function onMove(e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width * W;
    setHoverX(Math.max(padL, Math.min(W - padR, px)));
  }

  return (
    <div ref={wrapRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHoverX(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: 'auto' }}>
        {/* сетка Y */}
        {yticks.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={yOf(v)} x2={W - padR} y2={yOf(v)} stroke="#f1f5f9" />
            <text x={padL - 6} y={yOf(v) + 3} fontSize={10} fill="#94a3b8" textAnchor="end">{v.toFixed(1)}%</text>
          </g>
        ))}
        {/* тики X */}
        {xticks.map((t, i) => (
          <text key={i} x={t.x} y={H - 8} fontSize={10} fill="#94a3b8" textAnchor="middle">{t.label}</text>
        ))}
        {/* линии регионов */}
        {shown.map(r => (
          <polyline
            key={r.code}
            points={r.observations.map(o => `${xOf(tms(o.date)).toFixed(1)},${yOf(o.value).toFixed(1)}`).join(' ')}
            fill="none" stroke={r.color} strokeWidth={1.8}
          />
        ))}
        {/* hover-крестик и точки */}
        {hover && (
          <g>
            <line x1={hover.x} y1={padT} x2={hover.x} y2={H - padB} stroke="#cbd5e1" strokeDasharray="3 3" />
            {hover.items.map(it => (
              <circle key={it.code} cx={hover!.x} cy={it.cy} r={3.5} fill={it.color} stroke="#fff" strokeWidth={1} />
            ))}
          </g>
        )}
      </svg>
      {hover && hover.items.length > 0 && (
        <div
          className="absolute pointer-events-none bg-white border border-neutral-200 rounded shadow-md text-xs p-2"
          style={{
            left: `calc(${(hover.x / W) * 100}% + 8px)`,
            top: 8,
            transform: (hover.x / W) > 0.7 ? 'translateX(-100%) translateX(-16px)' : undefined,
          }}
        >
          <div className="font-medium mb-1">{hover.items[0].date}</div>
          {hover.items.map(it => (
            <div key={it.code} className="flex items-center gap-2 whitespace-nowrap">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: it.color }} />
              <span className="text-neutral-600">{it.name}</span>
              <span className="font-mono ml-auto">{fmtPct(it.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeveragePage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const addLog = (m: string) => setLog(p => [`[${new Date().toLocaleTimeString()}] ${m}`, ...p].slice(0, 30));

  // импорт региона
  const [impCode, setImpCode] = useState('KR');
  const [impCsv, setImpCsv] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/leverage/mdmc').then(r => r.json());
      if (r.error) { addLog('overview: ' + r.error); setRegions([]); }
      else {
        const regs: Region[] = r.regions || [];
        setRegions(regs);
        setVisible(prev => {
          const next = { ...prev };
          for (const reg of regs) if (!(reg.code in next)) next[reg.code] = true;
          return next;
        });
      }
    } catch (e: any) { addLog('overview: ' + e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // США: FRED (market cap) + FINRA (margin debt) → автопересчёт mdmc:US
  async function loadUS() {
    setBusy('US');
    try {
      addLog('США: загрузка FRED (market cap)...');
      const fred = await fetch('/api/leverage/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'fred' }),
      }).then(r => r.json());
      if (fred.error) addLog('FRED: ' + fred.error);
      addLog('США: загрузка FINRA (margin debt, авто)...');
      const finra = await fetch('/api/leverage/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'finra' }),
      }).then(r => r.json());
      if (finra.error) addLog('FINRA: ' + finra.error);
      const us = (finra.results || []).find((x: any) => x.id === 'mdmc:US');
      if (us) addLog(us.error ? 'США %: ' + us.error : `США %: ${us.rows} точек`);
      await load();
    } catch (e: any) { addLog('США: ' + e.message); }
    finally { setBusy(null); }
  }

  async function importRegion() {
    if (!impCode.trim() || !impCsv.trim()) return;
    setBusy('import');
    try {
      const r = await fetch('/api/leverage/region', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: impCode, csv: impCsv }),
      }).then(r => r.json());
      if (r.error) addLog(`${impCode}: ` + r.error);
      else { addLog(`${impCode}: ${r.rows} точек (режим: ${r.mode})`); setImpCsv(''); await load(); }
    } catch (e: any) { addLog(`${impCode}: ` + e.message); }
    finally { setBusy(null); }
  }

  async function removeRegion(code: string) {
    if (code === 'US') { addLog('США пересчитывается автоматически; удалять смысла нет'); return; }
    setBusy('del-' + code);
    try {
      await fetch(`/api/leverage/region?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
      addLog(`${code}: удалён`);
      await load();
    } catch (e: any) { addLog(`${code}: ` + e.message); }
    finally { setBusy(null); }
  }

  const latest = (r: Region) => r.observations.length ? r.observations[r.observations.length - 1] : null;

  return (
    <main>
      <section className="card">
        <h2 className="text-lg font-semibold">Margin Debt / Market Cap по регионам</h2>
        <p className="text-xs text-neutral-500 mt-1 max-w-3xl">
          Маржинальный долг как % от капитализации рынка, в динамике. США считается автоматически
          (FINRA margin debt / FRED Z.1 market cap). Другие регионы — импортом CSV
          (<code>date, margin_debt, market_cap</code> либо <code>date, pct</code>). Наведите курсор на график.
        </p>
        <div className="flex flex-wrap gap-2 items-center mt-3">
          <button className="btn-primary" disabled={!!busy} onClick={loadUS}>
            {busy === 'US' ? 'Загрузка США...' : 'Загрузить / обновить США'}
          </button>
          <button className="btn" disabled={loading} onClick={load}>{loading ? '...' : 'Обновить график'}</button>
          <span className="text-xs text-neutral-500">США требует <code>FRED_API_KEY</code>. FINRA качается с finra.org.</span>
        </div>
      </section>

      {/* График */}
      <section className="card">
        <div className="flex flex-wrap gap-3 items-center mb-2">
          {regions.map(r => {
            const lv = latest(r);
            const on = visible[r.code];
            return (
              <button
                key={r.code}
                onClick={() => setVisible(v => ({ ...v, [r.code]: !v[r.code] }))}
                className={`flex items-center gap-1.5 text-sm px-2 py-1 rounded border ${on ? 'bg-white' : 'bg-neutral-100 opacity-50'}`}
              >
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: r.color }} />
                <span>{r.name}</span>
                <span className="font-mono text-neutral-500">{fmtPct(lv?.value)}</span>
              </button>
            );
          })}
        </div>
        <MdmcChart regions={regions} visible={visible} />
      </section>

      {/* Управление регионами */}
      <section className="card">
        <h3 className="font-semibold mb-2">Добавить / обновить регион (CSV)</h3>
        <p className="text-xs text-neutral-500 mb-2">
          Колонки: <code>date</code> + <code>margin_debt</code> + <code>market_cap</code> (посчитаем %), либо <code>date</code> + <code>pct</code> (готовый %).
          Даты: <code>2024-01</code>, <code>Jan-24</code>, <code>01/2024</code>.
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col">
            <span className="label">Регион</span>
            <input
              list="region-codes" className="input w-40" value={impCode}
              onChange={e => setImpCode(e.target.value.toUpperCase())} placeholder="KR"
            />
            <datalist id="region-codes">
              {REGION_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
            </datalist>
          </label>
        </div>
        <textarea
          className="input w-full mt-2 font-mono text-xs" rows={5}
          placeholder={'date,margin_debt,market_cap\n2024-01,18500,2100000\n2024-02,19000,2150000'}
          value={impCsv} onChange={e => setImpCsv(e.target.value)}
        />
        <button className="btn-primary mt-2" disabled={!!busy || !impCsv.trim() || !impCode.trim()} onClick={importRegion}>
          {busy === 'import' ? 'Импорт...' : 'Импортировать регион'}
        </button>

        {regions.length > 0 && (
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="bg-neutral-100 text-left">
                <th className="p-2 border">Регион</th>
                <th className="p-2 border">Последнее</th>
                <th className="p-2 border">Дата</th>
                <th className="p-2 border">Точек</th>
                <th className="p-2 border">Лаг</th>
                <th className="p-2 border"></th>
              </tr>
            </thead>
            <tbody>
              {regions.map(r => {
                const lv = latest(r);
                return (
                  <tr key={r.code} className="hover:bg-neutral-50">
                    <td className="p-2 border">
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: r.color }} />
                      {r.name} <span className="text-neutral-400 font-mono">{r.code}</span>
                    </td>
                    <td className="p-2 border font-mono">{fmtPct(lv?.value)}</td>
                    <td className="p-2 border text-xs">{lv?.date ?? '—'}</td>
                    <td className="p-2 border">{r.observations.length}</td>
                    <td className="p-2 border text-xs text-neutral-500">{r.lagNote}</td>
                    <td className="p-2 border">
                      {r.code !== 'US' && (
                        <button className="btn" disabled={!!busy} onClick={() => removeRegion(r.code)}>
                          {busy === 'del-' + r.code ? '...' : 'Удалить'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {log.length > 0 && (
        <section className="card"><div className="log">{log.join('\n')}</div></section>
      )}
    </main>
  );
}
