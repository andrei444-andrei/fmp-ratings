'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cellColor, textColorOn } from '@/lib/superinvestor/compute';
import { INVESTOR_TYPE_LABEL, type InvestorType, type LeaderboardRow } from '@/lib/superinvestor/types';
import { PERIODS, periodQuery, type PeriodKey } from '@/lib/superinvestor/periods';
import { pctP, pctFu, money, fixed } from '@/lib/superinvestor/format';
import { safeFetchJson } from './_components/fetchJson';
import AddInvestor from './_components/AddInvestor';

type SortKey = 'alphaPct' | 'alphaAnnPct' | 'copyReturnPct' | 'spyReturnPct' | 'winRatePct' | 'sharpe' | 'maxDrawdownPct' | 'closedTrades' | 'aum';

const TYPES: InvestorType[] = ['value', 'activist', 'macro', 'concentrated', 'quant'];

export default function LeaderboardPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>('3');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<InvestorType>>(new Set(TYPES));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'alphaPct', dir: -1 });
  const [total, setTotal] = useState(10);
  const [warming, setWarming] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRows([]);
    setError(null);
    setWarming(false);
    attempts.current = 0;

    async function load() {
      const res = await safeFetchJson(`/api/superinvestor/leaderboard?${periodQuery(period)}`);
      if (!alive) return;
      attempts.current++;

      // Серверный таймаут/не-JSON: расчёт идёт, кэш греется — продолжаем опрос.
      if (res.transient) {
        setWarming(true);
        setLoading(false);
        if (attempts.current < 80) timer.current = setTimeout(load, 5000);
        else setError('Расчёт занимает дольше обычного. Промежуточные данные кэшируются — обновите страницу позже.');
        return;
      }

      const data = res.data || {};
      if (data.error) { setError(data.error); setLoading(false); setWarming(false); return; }
      setWarming(false);
      setRows(data.rows || []);
      setPending(data.pending || []);
      setTotal(data.total || 10);
      setLoading(false);
      if ((data.pending || []).length > 0 && attempts.current < 80) {
        timer.current = setTimeout(load, 4000); // дозапрос холодных позиций
      }
    }
    load();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [period, reloadKey]);

  // Шкала цвета — по 90-му перцентилю |α| (устойчиво к выбросам) с потолком,
  // чтобы один аномальный инвестор не «гасил» градиент у остальных.
  const clamp = useMemo(() => {
    const a = rows.map(r => Math.abs(r.alphaPct) / 100).filter(x => isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return 0.5;
    const p90 = a[Math.floor(a.length * 0.9)] ?? a[a.length - 1];
    return Math.min(8, Math.max(0.2, p90));
  }, [rows]);

  const visible = useMemo(() => {
    const f = rows.filter(r => activeTypes.has(r.investor.type));
    const k = sort.key;
    return [...f].sort((a, b) => ((a[k] as number) - (b[k] as number)) * sort.dir);
  }, [rows, activeTypes, sort]);

  function toggleType(t: InvestorType) {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next.size ? next : new Set(TYPES);
    });
  }
  function th(key: SortKey, label: string, cls = '') {
    const on = sort.key === key;
    return (
      <th className={`sortable ${cls}`} onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === -1 ? 1 : -1 }))}>
        {label}{on && <span className="arr">{sort.dir === -1 ? '↓' : '↑'}</span>}
      </th>
    );
  }

  return (
    <main>
      <div className="si-top">
        <div className="si-title">Super<b>investors</b> · copy-α vs SPY</div>
        <div className="si-sub">
          Доходность стратегии «копируем 13F-портфель на дату подачи филинга» против SPY за выбранное окно.
        </div>
      </div>

      <div className="si-method">
        <h4>Методология</h4>
        <ul>
          <li>Каждый квартал виртуальный портфель ребалансируется под раскрытые в <b>13F</b> веса позиций на <b>дату подачи филинга</b> (не на конец квартала — филинг публикуется с лагом ~45 дней).</li>
          <li><b>copy α</b> = совокупная доходность copy-стратегии − доходность SPY за то же окно. Цвет ячейки = насыщенность α (тот же градиент, что в heatmap).</li>
          <li><b>Win rate</b> — доля прибыльных закрытых сделок. <b>Sharpe</b> — годовой по месячным доходностям copy. <b>Max DD</b> — макс. просадка copy-кривой.</li>
          <li>Источник: FMP institutional-ownership (Form 13F) + дневные цены закрытия. Учитываются только длинные позиции в акциях США.</li>
        </ul>
      </div>

      <AddInvestor onChanged={() => setReloadKey(k => k + 1)} />

      <div className="si-bar">
        <span className="lbl">Период</span>
        <div className="si-seg">
          {PERIODS.map(p => (
            <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <span className="lbl" style={{ marginLeft: 8 }}>Тип</span>
        {TYPES.map(t => (
          <button key={t} className={`si-tab ${activeTypes.has(t) ? 'on' : ''}`} style={{ padding: '4px 11px' }} onClick={() => toggleType(t)}>
            {INVESTOR_TYPE_LABEL[t]}
          </button>
        ))}
        <span className="si-spacer" />
        {(pending.length > 0 || warming) && !error && (
          <span className="si-mut">обновляется {rows.length}/{total}…</span>
        )}
      </div>

      {error ? (
        <div className="si-panel"><div className="si-state si-err">Ошибка: {error}
          {/(ключ|key|403|401|402|forbidden|payment|institutional|api)/i.test(error) && (
            <><br /><span className="si-mut">Раздел требует FMP-ключ с доступом к institutional-ownership (Form 13F).</span></>
          )}
        </div></div>
      ) : (loading || warming) && !rows.length ? (
        <div className="si-panel"><div className="si-state">Считаем copy-стратегии по 13F на сервере — первый расчёт идёт частями и кэшируется, это может занять минуту…</div></div>
      ) : (
        <div className="si-tblwrap">
          <table className="si-tbl">
            <thead>
              <tr>
                <th className="l">#</th>
                <th className="l">Инвестор</th>
                {th('alphaPct', 'copy α vs SPY')}
                {th('alphaAnnPct', 'α / год')}
                {th('copyReturnPct', 'copy ret')}
                {th('spyReturnPct', 'SPY ret')}
                {th('winRatePct', 'win rate')}
                {th('sharpe', 'sharpe')}
                {th('maxDrawdownPct', 'max DD')}
                {th('closedTrades', 'сделок')}
                {th('aum', 'AUM')}
                <th className="l">топ-холдинги</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const aFrac = r.alphaPct / 100;
                const maxW = Math.max(...r.topHoldings.map(h => h.weight), 0.01);
                return (
                  <tr key={r.investor.slug} className="clk" onClick={() => router.push(`/superinvestor/${r.investor.slug}`)}>
                    <td className="l si-rank">{i + 1}</td>
                    <td className="l">
                      <span className="si-sym">{r.investor.name}</span>{' '}
                      <span className={`si-badge ${r.investor.type}`}>{INVESTOR_TYPE_LABEL[r.investor.type]}</span>
                      <div className="si-nm" style={{ fontSize: 11 }}>{r.investor.fund}</div>
                    </td>
                    <td className="si-alpha" style={{ background: cellColor(aFrac, clamp), color: textColorOn(aFrac, clamp) }}>
                      {pctP(r.alphaPct)}
                    </td>
                    <td className={r.alphaAnnPct >= 0 ? 'si-pos' : 'si-neg'}>{pctP(r.alphaAnnPct)}</td>
                    <td className={r.copyReturnPct >= 0 ? 'si-pos' : 'si-neg'}>{pctP(r.copyReturnPct)}</td>
                    <td className="si-mut">{pctP(r.spyReturnPct)}</td>
                    <td>{pctFu(r.winRatePct / 100)}</td>
                    <td>{fixed(r.sharpe, 2)}</td>
                    <td className="si-neg">{pctP(r.maxDrawdownPct)}</td>
                    <td>{r.closedTrades}</td>
                    <td className="si-mut">{money(r.aum)}</td>
                    <td className="l">
                      <span className="si-spark" title={r.topHoldings.map(h => `${h.symbol} ${pctFu(h.weight)}`).join(' · ')}>
                        {r.topHoldings.map((h, k) => (
                          <i key={k} style={{ height: Math.max(3, (h.weight / maxW) * 18) }} />
                        ))}
                      </span>{' '}
                      <span className="si-nm" style={{ fontSize: 10.5 }}>
                        {r.topHoldings.slice(0, 3).map(h => h.symbol).join(' ')}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr><td colSpan={12} className="l si-state">Нет инвесторов под фильтр.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
