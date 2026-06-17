'use client';

// Кликабельная тепловая карта: строки × столбцы, цвет ячейки — по знаку/величине метрики
// (зелёный↔красный единой палитрой, как в движке /research). Клик по ячейке → onSelect.

export type HeatCell = {
  row: number | string;
  col: number | string;
  value: number | null;
  n?: number;
  sig?: boolean;
};

function bg(value: number | null, vref: number): string {
  if (value == null || !Number.isFinite(value) || vref <= 0) return 'transparent';
  let t = value / vref;
  if (t > 1) t = 1;
  if (t < -1) t = -1;
  const a = Math.round(Math.pow(Math.abs(t), 0.7) * 0.78 * 1000) / 1000;
  if (t > 0) return `rgba(16,185,129,${a})`;
  if (t < 0) return `rgba(239,68,68,${a})`;
  return 'transparent';
}

export function Heatmap({
  cells,
  rows,
  cols,
  rowLabel,
  colLabel,
  selected,
  onSelect,
  fmt = (v) => (v == null ? '—' : v.toFixed(2)),
}: {
  cells: HeatCell[];
  rows: (number | string)[];
  cols: (number | string)[];
  rowLabel: string;
  colLabel: string;
  selected?: { row: number | string; col: number | string } | null;
  onSelect?: (cell: HeatCell) => void;
  fmt?: (v: number | null) => string;
}) {
  const lookup = new Map<string, HeatCell>();
  for (const c of cells) lookup.set(`${c.row}|${c.col}`, c);
  const vals = cells.map((c) => (c.value != null && Number.isFinite(c.value) ? Math.abs(c.value) : 0)).filter((x) => x > 0).sort((a, b) => a - b);
  const vref = vals.length ? vals[Math.floor(0.9 * (vals.length - 1))] || vals[vals.length - 1] : 1;

  return (
    <div className="overflow-auto">
      <table className="border-separate" style={{ borderSpacing: 3 }}>
        <thead>
          <tr>
            <th className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3 text-right">
              {rowLabel} \ {colLabel}
            </th>
            {cols.map((c) => (
              <th key={String(c)} className="px-2 py-1 text-[11px] font-semibold text-ink-2 text-center tabular-nums">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r)}>
              <td className="px-2 py-1 text-[11px] font-semibold text-ink text-right tabular-nums whitespace-nowrap">{r}</td>
              {cols.map((c) => {
                const cell = lookup.get(`${r}|${c}`);
                const v = cell?.value ?? null;
                const isSel = selected && selected.row === r && selected.col === c;
                return (
                  <td key={String(c)} className="p-0">
                    <button
                      type="button"
                      data-testid="heat-cell"
                      onClick={() => cell && onSelect?.(cell)}
                      title={cell ? `${rowLabel} ${r}, ${colLabel} ${c}\nЗначение: ${fmt(v)}${cell.n != null ? `\nN=${cell.n}` : ''}` : ''}
                      className={`relative flex h-12 w-[68px] flex-col items-center justify-center rounded-fk-sm border text-[12px] tabular-nums transition-all ${
                        isSel ? 'border-brand ring-[2px] ring-[var(--fk-ring)]' : 'border-line'
                      }`}
                      style={{ background: bg(v, vref) }}
                    >
                      <span className="font-semibold text-ink">{fmt(v)}</span>
                      {cell?.n != null && <span className="text-[9px] text-ink-3">n={cell.n}</span>}
                      {cell?.sig && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-fk-pill bg-brand" title="значимо (FDR)" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
