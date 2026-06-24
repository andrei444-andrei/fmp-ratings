'use client';

import { whitelistVsUniverse, type SelectionRule } from '../metrics';
import { COUNTRIES } from '../mock';
import { pct, pctU, signClass } from '../fmt';

const FLAG: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.flag]));

// Секция 4 — вайт-лист по сигналу vs держать всю вселенную. Главный ответ.
export default function WhitelistVsUniverse({ rule }: { rule: SelectionRule }) {
  const r = whitelistVsUniverse(rule);

  const ruleText =
    rule.kind === 'topK'
      ? `вайт-лист = топ-${rule.k} стран по консенсус-сигналу`
      : `вайт-лист = страны с консенсусом ≥ ${rule.min === 2 ? 'Strong OW' : rule.min === 1 ? 'OW' : 'EW'}`;

  const verdictClass = r.verdict === 'whitelist' ? 'win' : r.verdict === 'universe' ? 'lose' : '';
  const verdictIcon = r.verdict === 'whitelist' ? '✓' : r.verdict === 'universe' ? '✕' : '≈';
  const verdictLead =
    r.verdict === 'whitelist' ? 'Вайт-лист добавляет ценность — отбор по сигналу обыгрывает «держать всё».'
      : r.verdict === 'universe' ? 'Вайт-лист проигрывает — проще держать всю вселенную.'
        : 'Ничья — отбор по сигналу не даёт устойчивого преимущества над «держать всё».';

  return (
    <>
      <div className="qc-cards">
        <Card k="CAGR — вселенная" v={pct(r.universe.cagr)} sub="держать всё, EW" cls={signClass(r.universe.cagr)} />
        <Card k="CAGR — вайт-лист" v={pct(r.whitelist.cagr)} sub={ruleText} cls={signClass(r.whitelist.cagr)} />
        <Card k="Δ CAGR" v={pct(r.edgeCagr)} sub="вайт-лист − вселенная" cls={signClass(r.edgeCagr)} />
        <Card k="σ годовых" v={`${pctU(r.whitelist.std)} / ${pctU(r.universe.std)}`} sub="вайт-лист / вселенная" cls="qc-mut" />
      </div>

      <div className="qc-tblwrap">
        <table className="qc-matrix fc-matrix">
          <thead>
            <tr>
              <th className="yr" style={{ textAlign: 'left' }}>Год</th>
              <th>Вселенная (EW)</th>
              <th className="grp">Вайт-лист</th>
              <th style={{ textAlign: 'left' }}>Δ</th>
              <th style={{ textAlign: 'left' }}>Отобраны сигналом</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => {
              const edge = row.whitelistReal != null && row.universeReal != null ? row.whitelistReal - row.universeReal : null;
              return (
                <tr key={row.year}>
                  <td className="yr">{row.year}</td>
                  <td className={signClass(row.universeReal)}>{pct(row.universeReal)}</td>
                  <td className={'grp fc-r ' + signClass(row.whitelistReal)}>{pct(row.whitelistReal)}</td>
                  <td style={{ textAlign: 'left' }} className={signClass(edge)}>{edge != null ? pct(edge) : '—'}</td>
                  <td style={{ textAlign: 'left', fontFamily: 'inherit' }} className="qc-mut">
                    {row.picked.length ? row.picked.map((c) => FLAG[c] + c).join(' ') : '— (пусто)'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="stat total">
              <td className="yr">Итог (накопит.)</td>
              <td className={signClass(r.universe.cumulative)}>{pct(r.universe.cumulative)}</td>
              <td className={'grp ' + signClass(r.whitelist.cumulative)}>{pct(r.whitelist.cumulative)}</td>
              <td style={{ textAlign: 'left' }} className={signClass(r.whitelist.cumulative - r.universe.cumulative)}>{pct(r.whitelist.cumulative - r.universe.cumulative)}</td>
              <td style={{ textAlign: 'left' }} className="qc-mut">лет в плюс: {r.whitelist.hitYears}/{r.whitelist.n} vs {r.universe.hitYears}/{r.universe.n}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className={'fc-verdict ' + verdictClass}>
        <div className="lead"><span className="ic">{verdictIcon}</span> {verdictLead}</div>
        <div className="body">{ruleText}. Накопит. разница {pct(r.whitelist.cumulative - r.universe.cumulative)}, CAGR {pct(r.edgeCagr)}/год.</div>
        <div className="caveat">⚠ {r.caveat}</div>
      </div>
    </>
  );
}

function Card({ k, v, sub, cls }: { k: string; v: string; sub: string; cls?: string }) {
  return (
    <div className="qc-card">
      <div className="qc-card-k">{k}</div>
      <div className={'qc-card-v ' + (cls ?? '')}>{v}</div>
      <div className="qc-card-sub">{sub}</div>
    </div>
  );
}
