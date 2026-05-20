'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useInvestorDetail } from '../../_components/useDetail';
import { cellColor, textColorOn } from '@/lib/superinvestor/compute';
import { investorBySlug } from '@/lib/superinvestor/registry';
import { pctF, pctFu, fixed } from '@/lib/superinvestor/format';
import type { ClosedTrade } from '@/lib/superinvestor/types';

type Profit = 'all' | 'win' | 'loss';
type SortKey = 'closeDate' | 'returnPct' | 'alphaPct' | 'holdingDays';

export default function TradesPage() {
  const params = useParams();
  const slug = String(params.slug || '');
  const inv = investorBySlug(slug);
  const [years, setYears] = useState(5);
  const { data, loading, error } = useInvestorDetail(slug, years, false);

  const [yearF, setYearF] = useState<number | 'all'>('all');
  const [profit, setProfit] = useState<Profit>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'closeDate', dir: -1 });

  const trades = data?.closedTrades || [];
  const tradeYears = useMemo(() => Array.from(new Set(trades.map(t => t.year))).sort((a, b) => b - a), [trades]);
  const clamp = useMemo(() => Math.max(0.15, ...trades.map(t => Math.abs(t.alphaPct) / 100)), [trades]);

  const visible = useMemo(() => {
    let f = trades;
    if (yearF !== 'all') f = f.filter(t => t.year === yearF);
    if (profit === 'win') f = f.filter(t => t.returnPct > 0);
    if (profit === 'loss') f = f.filter(t => t.returnPct <= 0);
    const key = sort.key;
    const val = (t: ClosedTrade) => key === 'closeDate' ? +new Date(t.closeDate) : (t[key] as number);
    return [...f].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [trades, yearF, profit, sort]);

  const stats = useMemo(() => {
    if (!visible.length) return null;
    const wins = visible.filter(t => t.returnPct > 0).length;
    const avgAlpha = visible.reduce((s, t) => s + t.alphaPct, 0) / visible.length;
    return { n: visible.length, winRate: wins / visible.length, avgAlpha };
  }, [visible]);

  function th(key: SortKey, label: string) {
    const on = sort.key === key;
    return (
      <th className="sortable" onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === -1 ? 1 : -1 }))}>
        {label}{on && <span className="arr">{sort.dir === -1 ? '↓' : '↑'}</span>}
      </th>
    );
  }

  return (
    <main>
      <div className="si-top">
        <div className="si-title">Закрытые сделки · {inv?.name}</div>
        <div className="si-sub">Все полностью закрытые позиции (акции доведены до 0) с альфой относительно SPY за окно удержания.</div>
      </div>

      <div className="si-method">
        <h4>Как считается сделка</h4>
        <ul>
          <li>Вход — средневзвешенная цена на даты подачи 13F, когда позиция набиралась; выход — цена на дату филинга, где доля обнулилась.</li>
          <li><b>alpha</b> = доходность сделки − доходность SPY за то же окно. Цвет ячейки alpha = насыщенность (зелёный — обыграл рынок, красный — проиграл).</li>
        </ul>
      </div>

      <div className="si-bar">
        <span className="lbl">Период</span>
        <div className="si-seg">{[3, 5].map(y => <button key={y} className={years === y ? 'on' : ''} onClick={() => setYears(y)}>{y}г</button>)}</div>
        <span className="lbl" style={{ marginLeft: 8 }}>Год закрытия</span>
        <div className="si-seg">
          <button className={yearF === 'all' ? 'on' : ''} onClick={() => setYearF('all')}>все</button>
          {tradeYears.map(y => <button key={y} className={yearF === y ? 'on' : ''} onClick={() => setYearF(y)}>{y}</button>)}
        </div>
        <span className="lbl" style={{ marginLeft: 8 }}>Результат</span>
        <div className="si-seg">
          <button className={profit === 'all' ? 'on' : ''} onClick={() => setProfit('all')}>все</button>
          <button className={profit === 'win' ? 'on' : ''} onClick={() => setProfit('win')}>прибыльные</button>
          <button className={profit === 'loss' ? 'on' : ''} onClick={() => setProfit('loss')}>убыточные</button>
        </div>
        <span className="si-spacer" />
        {stats && <span className="si-mut">{stats.n} сделок · win {pctFu(stats.winRate)} · ср. α {stats.avgAlpha >= 0 ? '+' : '−'}{Math.abs(stats.avgAlpha).toFixed(1)}пп</span>}
      </div>

      {error ? (
        <div className="si-panel"><div className="si-state si-err">Ошибка: {error}</div></div>
      ) : loading && !data ? (
        <div className="si-panel"><div className="si-state">Загрузка сделок…</div></div>
      ) : (
        <div className="si-tblwrap">
          <table className="si-tbl">
            <thead>
              <tr>
                <th className="l">тикер</th>
                <th className="l">компания</th>
                <th className="l">открыта</th>
                <th className="l">закрыта</th>
                {th('holdingDays', 'дней')}
                <th>вход</th>
                <th>выход</th>
                {th('returnPct', 'доходность')}
                <th>SPY</th>
                {th('alphaPct', 'alpha')}
              </tr>
            </thead>
            <tbody>
              {visible.map((t, i) => {
                const aFrac = t.alphaPct / 100;
                return (
                  <tr key={`${t.symbol}-${t.closeDate}-${i}`}>
                    <td className="l si-sym">{t.symbol}</td>
                    <td className="l si-nm">{t.name || '—'}</td>
                    <td className="l si-mut">{t.openDate}</td>
                    <td className="l si-mut">{t.closeDate}</td>
                    <td className="si-mut">{t.holdingDays}</td>
                    <td className="si-mut">{fixed(t.entryPrice)}</td>
                    <td className="si-mut">{fixed(t.exitPrice)}</td>
                    <td className={t.returnPct >= 0 ? 'si-pos' : 'si-neg'}>{pctF(t.returnPct)}</td>
                    <td className="si-mut">{pctF(t.spyReturnPct)}</td>
                    <td className="si-alpha" style={{ background: cellColor(aFrac, clamp), color: textColorOn(aFrac, clamp) }}>{pctF(t.alphaPct)}</td>
                  </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={10} className="l si-state">Нет сделок под фильтр.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
