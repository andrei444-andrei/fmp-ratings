'use client';

import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

const LINKS = [
  { href: '/terminal', label: 'Рыночный терминал' },
  { href: '/ticker', label: 'Анализ тикера' },
  { href: '/researcher', label: 'Скринер' },
  { href: '/signals', label: 'Модель сигналов' },
  { href: '/switch', label: 'Переключение A/B' },
  { href: '/backtest', label: 'Тестирование стратегий' },
  { href: '/quant', label: 'Аналитика алгоритмов' },
  { href: '/polymarket', label: 'Polymarket' },
  { href: '/admin', label: 'Admin' },
];

export default function Nav() {
  const path = usePathname() || '';
  const isActive = (href: string) =>
    href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/');

  return (
    <header className="app-nav">
      <div className="app-nav-in">
        <a href="/terminal" className="app-brand" aria-label="Market Lab">
          <span className="app-brand-dot" />
        </a>
        <nav className="app-nav-links">
          {LINKS.map(l => (
            <a key={l.href} href={l.href} className={`app-nav-link${isActive(l.href) ? ' active' : ''}`}>
              {l.label}
            </a>
          ))}
        </nav>
        <ThemeToggle />
        <a href="https://github.com" target="_blank" rel="noreferrer" className="app-nav-gh">GitHub</a>
      </div>
    </header>
  );
}
