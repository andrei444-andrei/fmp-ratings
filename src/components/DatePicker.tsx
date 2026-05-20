'use client';

import { useEffect, useRef, useState } from 'react';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const WD = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const pad = (n: number) => String(n).padStart(2, '0');

export default function DatePicker({
  value, onChange, min, max,
}: {
  value: string;            // YYYY-MM-DD
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const [y, m] = value.split('-').map(Number);
    const now = new Date();
    return { y: y || now.getFullYear(), m: (m ? m - 1 : now.getMonth()) };
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const [y, m] = value.split('-').map(Number);
      if (y && m) setView({ y, m: m - 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const firstDow = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Пн = 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function shift(delta: number) {
    setView(v => {
      let m = v.m + delta, y = v.y;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      return { y, m };
    });
  }
  function pick(d: number) {
    const iso = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
    if (min && iso < min) return;
    if (max && iso > max) return;
    onChange(iso);
    setOpen(false);
  }

  return (
    <div className="hm-dp" ref={ref}>
      <button type="button" className="hm-dp-trigger" onClick={() => setOpen(o => !o)}>
        {value || '—'}
      </button>
      <div className={`hm-dp-pop ${open ? 'open' : ''}`}>
        <div className="hm-dp-h">
          <button type="button" onClick={() => shift(-1)}>‹</button>
          <span>{MONTHS[view.m]} {view.y}</span>
          <button type="button" onClick={() => shift(1)}>›</button>
        </div>
        <div className="hm-dp-wd">{WD.map(w => <span key={w}>{w}</span>)}</div>
        <div className="hm-dp-grid">
          {cells.map((d, i) => {
            if (d == null) return <span key={i} />;
            const iso = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
            const sel = iso === value;
            const dis = (min && iso < min) || (max && iso > max);
            return (
              <button
                key={i}
                type="button"
                className={`${sel ? 'sel' : ''} ${dis ? 'dis' : ''}`}
                disabled={!!dis}
                onClick={() => pick(d)}
              >{d}</button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
