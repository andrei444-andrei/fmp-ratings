// Форматирование чисел для прототипа.

// Доля (0.123) → «+12.3%».
export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100;
  const s = p > 0 ? '+' : p < 0 ? '−' : '';
  return s + Math.abs(p).toFixed(digits) + '%';
}

// Без знака (для σ, MAE).
export function pctU(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return (Math.abs(v) * 100).toFixed(digits) + '%';
}

// Коэффициент −1..1 (IC и т.п.).
export function coef(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return s + Math.abs(v).toFixed(digits);
}

export function signClass(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return 'qc-mut';
  return v > 0 ? 'qc-pos' : 'qc-neg';
}
