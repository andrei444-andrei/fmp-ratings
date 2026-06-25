'use client';

import { consensusOf, type Cell, type SignalTier } from '../mock';
import { pct } from '../fmt';

// Чип консенсус-сигнала по ячейке. Клик → открыть панель источников (панель
// рендерит ForecastMatrix под таблицей, чтобы не обрезалась скроллом).

export function tierClass(t: SignalTier | null): string {
  if (t == null) return 'na';
  return t === 2 ? 't2' : t === 1 ? 't1' : t === 0 ? 't0' : t === -1 ? 'tm1' : 'tm2';
}

export default function SignalChip({
  cell, onOpen, active,
}: { cell: Cell; onOpen?: (c: Cell) => void; active?: boolean }) {
  const con = consensusOf(cell);

  if (con.tier == null) {
    return <span className="fc-chip na" title="Нет прогноза (пропуск данных)">— нет</span>;
  }
  const label = con.tier >= 1 ? 'OW' + (con.tier === 2 ? '+' : '') : con.tier <= -1 ? 'UW' + (con.tier === -2 ? '−' : '') : 'EW';
  const text = label + (con.expectedReturn != null ? ' ' + pct(con.expectedReturn, 0) : '');

  return (
    <button
      type="button"
      className={'fc-chip btn ' + tierClass(con.tier) + (active ? ' active' : '')}
      title={`${con.n} ист. · клик — источники`}
      onClick={() => onOpen?.(cell)}
    >
      {text}
      <span className="fc-chip-n">{con.n}</span>
      {con.spread >= 2 && <span className="fc-chip-dis" title="Банки расходятся">⚡</span>}
    </button>
  );
}
