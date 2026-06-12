'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  // Стартовое значение уже выставлено инлайн-скриптом в layout (без мигания) —
  // здесь только синхронизируем стейт кнопки с текущим data-theme.
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
  }

  return (
    <button
      type="button"
      className="app-theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
