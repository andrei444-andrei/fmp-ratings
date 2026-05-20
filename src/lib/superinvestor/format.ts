// Форматтеры (client-safe).

function signed(v: number, digits: number): string {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  return (v >= 0 ? '+' : '−') + a.toFixed(digits);
}

// Значение уже в процентах (12.3 → «+12.3%»).
export function pctP(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return signed(v, digits) + '%';
}

// Доля 0..1 → проценты.
export function pctF(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return signed(v * 100, digits) + '%';
}

// Без знака, доля 0..1 → «12.3%».
export function pctFu(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return (v * 100).toFixed(digits) + '%';
}

export function money(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function num(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

export function fixed(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}
