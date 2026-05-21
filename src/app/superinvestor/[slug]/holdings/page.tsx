'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useInvestorDetail } from '../../_components/useDetail';
import { cellColor, textColorOn } from '@/lib/superinvestor/compute';
import { investorBySlug } from '@/lib/superinvestor/registry';
import { PERIODS, type PeriodKey } from '@/lib/superinvestor/periods';
import { pctFu } from '@/lib/superinvestor/format';

export default function HoldingsHeatmapPage() {
  const params = useParams();
  const slug = String(params.slug || '');
  const inv = investorBySlug(slug);
  const [period, setPeriod] = useState<PeriodKey>('5');
  const { data, loading, error } = useInvestorDetail(slug, period, false);
  const invMeta = data?.investor || inv;

  const hm = data?.heatmap;
  const clamp = useMemo(() => {
    if (!hm) return 0.1;
    let mx = 0;
    for (const s of hm.symbols) for (const w of hm.weights[s]) if (w != null) mx = Math.max(mx, w);
    return Math.max(0.05, mx);
  }, [hm]);

  // первая/последняя позиция по каждому символу — для маркеров входа/выхода
  const meta = useMemo(() => {
    const m: Record<string, { first: number; last: number }> = {};
    if (hm) for (const s of hm.symbols) {
      const arr = hm.weights[s];
      let first = -1, last = -1;
      arr.forEach((w, i) => { if (w != null) { if (first < 0) first = i; last = i; } });
      m[s] = { first, last };
    }
    return m;
  }, [hm]);

  return (
    <main>
      <div className="si-top">
        <div className="si-title">Heatmap холдингов · {invMeta?.name}</div>
        <div className="si-sub">Тикеры × кварталы. Насыщенность зелёного = вес позиции в портфеле 13F.</div>
      </div>

      <div className="si-method">
        <h4>Как читать</h4>
        <ul>
          <li>Строки упорядочены по свежести: вверху — то, что в портфеле сейчас, ниже — закрытые позиции.</li>
          <li><span className="si-pos">▎</span> слева у ячейки — квартал входа. Метка <b>вышел</b> — позиция закрыта к последнему кварталу, <b>новая</b> — появилась только что.</li>
        </ul>
      </div>

      <div className="si-bar">
        <span className="lbl">Период</span>
        <div className="si-seg">{PERIODS.map(p => <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}</div>
        <span className="si-spacer" />
        {hm && <span className="si-mut">{hm.symbols.length} тикеров · {hm.periods.length} кварталов</span>}
      </div>

      {error ? (
        <div className="si-panel"><div className="si-state si-err">Ошибка: {error}</div></div>
      ) : loading && !data ? (
        <div className="si-panel"><div className="si-state">Загрузка холдингов…</div></div>
      ) : !hm || !hm.symbols.length ? (
        <div className="si-panel"><div className="si-state">Нет данных холдингов.</div></div>
      ) : (
        <>
          <div className="hm-gridwrap">
            <table className="hm-table">
              <thead>
                <tr>
                  <th className="tk">Тикер</th>
                  {hm.periods.map(p => (
                    <th key={p}><div className="hm-dh"><div className="dt">{p.replace('Q', ' Q')}</div></div></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hm.symbols.map(sym => {
                  const arr = hm.weights[sym];
                  const mt = meta[sym];
                  const heldLatest = mt.last === hm.periods.length - 1;
                  const brandNew = mt.first === hm.periods.length - 1;
                  return (
                    <tr key={sym}>
                      <td className="tk" title={hm.names[sym] || sym}>
                        <div className="hm-tkrow">
                          <span className="hm-tk-sym">{sym}</span>
                          {!heldLatest && <span className="si-badge" style={{ fontSize: 8, padding: '1px 5px', color: 'var(--hm-neg)', borderColor: 'rgba(244,98,106,.4)' }}>вышел</span>}
                          {heldLatest && brandNew && <span className="si-badge" style={{ fontSize: 8, padding: '1px 5px', color: 'var(--hm-pos)', borderColor: 'rgba(52,211,153,.4)' }}>новая</span>}
                        </div>
                      </td>
                      {arr.map((w, i) => {
                        const isEntry = i === mt.first;
                        return (
                          <td key={i}
                            style={{
                              background: w != null ? cellColor(w, clamp) : 'transparent',
                              color: textColorOn(w, clamp),
                              minWidth: 44, width: 44,
                              borderLeft: isEntry ? '1.5px solid var(--hm-pos)' : undefined,
                            }}
                            title={`${sym} · ${hm.periods[i]}${w != null ? ' · ' + pctFu(w) : ' · нет позиции'}`}>
                            {w != null ? (w * 100).toFixed(w >= 0.1 ? 0 : 1) : '·'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hm-legend">
            <span className="sc">
              <i style={{ background: 'rgba(52,211,153,.16)' }} />
              <i style={{ background: 'rgba(52,211,153,.4)' }} />
              <i style={{ background: 'rgba(52,211,153,.7)' }} />
              <i style={{ background: 'rgba(52,211,153,.9)' }} />
              &nbsp; вес 0 → {pctFu(clamp, 0)}
            </span>
            <span><span className="si-pos">▎</span> квартал входа</span>
          </div>
        </>
      )}
    </main>
  );
}
