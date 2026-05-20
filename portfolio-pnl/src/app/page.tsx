'use client';

import { useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { NetWorthChart, AllocationDonut, BridgeChart } from '@/components/charts';
import { ASSET_CLASS_COLOR } from '@/lib/types';
import { fmtMoney, fmtSignedMoney, fmtPct, fmtQuarter } from '@/lib/format';
import type { OverviewData } from '@/lib/compute';

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [allQuarters, setAllQuarters] = useState<string[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [mode, setMode] = useState<'abs' | 'twr'>('abs');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(quarter: string | null) {
    setLoading(true);
    try {
      const url = quarter ? `/api/portfolio/overview?asOf=${quarter}` : '/api/portfolio/overview';
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');
      setData(json);
      if (!quarter && json.quarters) setAllQuarters(json.quarters);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(null); }, []);

  function onQuarter(q: string) {
    setAsOf(q);
    load(q);
  }

  if (loading && !data) {
    return <Shell active="overview"><div className="empty-state">Загрузка…</div></Shell>;
  }
  if (error) {
    return <Shell active="overview"><div className="notice notice-error">{error}</div></Shell>;
  }
  if (!data || data.quarters.length === 0) {
    return (
      <Shell active="overview">
        <div className="empty-state">
          <p style={{ fontSize: 16, color: 'var(--text)', marginBottom: 8 }}>Пока нет данных</p>
          <p>Добавьте позиции на странице <a href="/import">Ввод данных</a> — загрузите CSV брокера,<br />введите вручную или вставьте «как есть» и распознайте через AI.</p>
        </div>
      </Shell>
    );
  }

  const d = data;
  const quarterLabel = d.latestQuarter ? fmtQuarter(d.latestQuarter) : '';

  return (
    <Shell active="overview" quarters={allQuarters} selectedQuarter={asOf ?? d.latestQuarter} onQuarter={onQuarter}>
      {/* HERO */}
      <div className="hero">
        <div className="hero-header">
          <div>
            <div className="hero-label">Net worth · {quarterLabel}</div>
            <div className="hero-value">{fmtMoney(d.netWorth)}</div>
            <div className="hero-deltas">
              {d.deltas.yoy != null && <span className={d.deltas.yoy >= 0 ? 'up' : 'down'}>{d.deltas.yoy >= 0 ? '↑' : '↓'} {fmtPct(Math.abs(d.deltas.yoy))} YoY</span>}
              {d.deltas.qoq != null && <span className={d.deltas.qoq >= 0 ? 'up' : 'down'}>{d.deltas.qoq >= 0 ? '↑' : '↓'} {fmtPct(Math.abs(d.deltas.qoq))} QoQ</span>}
              {d.deltas.sinceStartQuarter && <span className="muted">{fmtSignedMoney(d.deltas.sinceStartAbs)} с {fmtQuarter(d.deltas.sinceStartQuarter)}</span>}
            </div>
          </div>
          <div className="toggle">
            <button className={mode === 'abs' ? 'on' : ''} onClick={() => setMode('abs')}>$ абсолют</button>
            <button className={mode === 'twr' ? 'on' : ''} onClick={() => setMode('twr')}>% индекс</button>
          </div>
        </div>

        <div className="chart-wrap">
          <NetWorthChart series={d.series} mode={mode} />
        </div>

        <div className="kpi-row">
          <Kpi label="TWR · YoY" value={d.kpis.twrYoY != null ? fmtPct(d.kpis.twrYoY) : '—'} valueClass={cls(d.kpis.twrYoY)} sub="качество стратегии" />
          <Kpi label="MWR · YoY" value={d.kpis.mwrYoY != null ? fmtPct(d.kpis.mwrYoY) : '—'} valueClass={cls(d.kpis.mwrYoY)} sub="фактическая на капитал" />
          <Kpi label="Чистые взносы" value={fmtSignedMoney(d.kpis.netContributions)} sub="пополнения − выводы" />
          <Kpi label="Доход за период" value={fmtMoney(d.kpis.income, { compact: true })} sub="рента + дивы + купоны" />
        </div>
      </div>

      {/* ALLOCATION + BRIDGE */}
      <div className="row-2">
        <div className="card">
          <div className="card-title">Аллокация</div>
          <div className="alloc-body">
            <AllocationDonut allocation={d.allocation} total={d.netWorth} />
            <div className="alloc-legend">
              {d.allocation.map((a) => (
                <div key={a.assetClass}>
                  <span><span className="sw" style={{ background: ASSET_CLASS_COLOR[a.assetClass] }} />{a.label}</span>
                  <span style={{ fontWeight: 500 }}>{fmtMoney(a.value, { compact: true })} · {a.pct.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">P&amp;L bridge · {d.bridge.startQuarter ? fmtQuarter(d.bridge.startQuarter) : ''} → {d.bridge.endQuarter ? fmtQuarter(d.bridge.endQuarter) : ''}</div>
          {d.bridge.steps.length > 0 ? <BridgeChart bridge={d.bridge} /> : <div className="muted" style={{ padding: '30px 0', textAlign: 'center' }}>Нужно ≥ 2 кварталов</div>}
        </div>
      </div>

      {/* MODULES */}
      <div className="modules-section">
        <div className="modules-title">Модули — подробная аналитика по сегментам</div>
        <div className="modules-grid">
          {d.modules.map((m) => (
            <div className="module-card" key={m.assetClass}>
              <div className="module-header"><span className="dot" style={{ background: ASSET_CLASS_COLOR[m.assetClass] }} />{m.label}</div>
              <div className="module-value">{fmtMoney(m.value, { compact: true })}</div>
              <div className={`module-metric ${cls(m.qoqPct)}`}>
                {m.qoqPct != null ? `${fmtPct(m.qoqPct)} QoQ` : '—'}
              </div>
              <div className="module-sub">
                {m.positions} {plural(m.positions, 'позиция', 'позиции', 'позиций')}
                {m.unrealizedPnl != null && <> · P&L {fmtSignedMoney(m.unrealizedPnl)}</>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* LIQUIDITY */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>Профиль ликвидности</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>из {fmtMoney(d.netWorth, { compact: true })} всего</div>
        </div>
        <div className="liq-grid">
          {d.liquidity.map((l) => (
            <LiqRow key={l.tier} label={l.label} pct={l.cumulativePct} value={l.cumulativeValue} tier={l.tier} />
          ))}
        </div>
      </div>

      {/* ALERTS */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="card-title" style={{ margin: 0 }}>Алерты и инсайты</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{d.alerts.length} активных</div>
        </div>
        {d.alerts.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Нет активных алертов — всё в норме.</div>}
        {d.alerts.map((a, i) => (
          <div className="alert" key={i}>
            <div className={`alert-icon icon-${a.level}`}>{a.level === 'danger' ? '!' : a.level === 'warning' ? '⚠' : 'i'}</div>
            <div className="alert-body">
              <div className="alert-title">{a.title}</div>
              <div className="alert-desc">{a.desc}</div>
            </div>
            <span className={`alert-badge badge-${a.badge === 'rebalance' ? 'rebalance' : a.level}`}>{a.badge}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Shell({ children, active, quarters, selectedQuarter, onQuarter }: {
  children: React.ReactNode;
  active: 'overview' | 'import';
  quarters?: string[];
  selectedQuarter?: string | null;
  onQuarter?: (q: string) => void;
}) {
  return (
    <div className="app">
      <TopBar active={active} quarters={quarters} selectedQuarter={selectedQuarter} onQuarter={onQuarter} />
      <div className="container">{children}</div>
    </div>
  );
}

function Kpi({ label, value, sub, valueClass }: { label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass ?? ''}`}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function LiqRow({ label, pct, value, tier }: { label: string; pct: number; value: number; tier: string }) {
  const colors: Record<string, string> = { t0: '#1D9E75', t7: '#97C459', t90: '#EF9F27', locked: '#D85A30' };
  return (
    <>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="bar"><span style={{ width: `${Math.max(pct, 0.5)}%`, background: colors[tier], minWidth: pct > 0 ? 4 : 0 }} /></div>
      <span style={{ textAlign: 'right' }}>{fmtMoney(value, { compact: true })} · {pct.toFixed(1)}%</span>
    </>
  );
}

function cls(v: number | null | undefined): string {
  if (v == null) return 'muted';
  return v >= 0 ? 'up' : 'down';
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
