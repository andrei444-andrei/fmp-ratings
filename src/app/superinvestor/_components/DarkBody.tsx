'use client';

import { useEffect } from 'react';

// Тёмная тема для всего документа, пока раздел смонтирован (как в /heatmap).
export default function DarkBody() {
  useEffect(() => {
    const b = document.body, h = document.documentElement;
    const pb = b.style.background, pc = b.style.color, ph = h.style.background;
    b.style.background = '#0a0b0e';
    b.style.color = '#e9eaed';
    h.style.background = '#0a0b0e';
    b.classList.add('hm-dark-body');
    return () => {
      b.style.background = pb;
      b.style.color = pc;
      h.style.background = ph;
      b.classList.remove('hm-dark-body');
    };
  }, []);
  return null;
}
