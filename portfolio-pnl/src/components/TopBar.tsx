'use client';

export function TopBar({
  active,
  quarters,
  selectedQuarter,
  onQuarter,
}: {
  active: 'overview' | 'import';
  quarters?: string[];
  selectedQuarter?: string | null;
  onQuarter?: (q: string) => void;
}) {
  return (
    <div className="topbar">
      <div className="nav">
        <a href="/" className={active === 'overview' ? 'active' : ''}>Overview</a>
        <a href="/import" className={active === 'import' ? 'active' : ''}>Ввод данных</a>
      </div>
      <div className="topbar-actions">
        {quarters && quarters.length > 0 && (
          <span className="pill">
            <select value={selectedQuarter ?? ''} onChange={(e) => onQuarter?.(e.target.value)}>
              {quarters.map((q) => (
                <option key={q} value={q}>{fmtQ(q)}</option>
              ))}
            </select>
          </span>
        )}
        <a className="icon-btn" href="/import" title="Добавить данные">＋</a>
      </div>
    </div>
  );
}

function fmtQ(q: string): string {
  const m = q.match(/^(\d{4})Q([1-4])$/);
  return m ? `${m[2]}Q${m[1].slice(2)}` : q;
}
