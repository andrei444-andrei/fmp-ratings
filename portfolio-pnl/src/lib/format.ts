export function fmtMoney(v: number, opts: { compact?: boolean } = {}): string {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (opts.compact) {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
    return `${sign}$${abs.toFixed(0)}`;
  }
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function fmtSignedMoney(v: number, compact = true): string {
  const s = fmtMoney(Math.abs(v), { compact });
  return v >= 0 ? `+${s}` : `-${s}`;
}

export function fmtPct(v: number, digits = 1): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

// '2026Q1' -> '1Q26'  (как в референсе)
export function fmtQuarter(q: string): string {
  const m = q.match(/^(\d{4})Q([1-4])$/);
  if (!m) return q;
  return `${m[2]}Q${m[1].slice(2)}`;
}

export function quarterYear(q: string): number {
  return parseInt(q.slice(0, 4), 10);
}
