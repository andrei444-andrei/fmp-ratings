'use client';

import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

const LINKS = [
  { href: '/heatmap', label: 'Heatmap' },
  { href: '/ticker', label: 'Тикер' },
  { href: '/superinvestor', label: 'Superinvestors' },
  { href: '/admin/ai-events', label: 'AI Events' },
  { href: '/admin/ticker-sets', label: 'Тикеры' },
  { href: '/admin', label: 'Admin' },
];

export default function Nav() {
  const path = usePathname() || '';
  const isActive = (href: string) =>
    href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/');

  return (
    <header className="app-nav">
      <div className="app-nav-in">
        <a href="/heatmap" className="app-brand" aria-label="Heatmap">
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
