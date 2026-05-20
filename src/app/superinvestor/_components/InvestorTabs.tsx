'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function InvestorTabs({ slug }: { slug: string }) {
  const path = usePathname() || '';
  const base = `/superinvestor/${slug}`;
  const tabs = [
    { href: base, label: 'Обзор' },
    { href: `${base}/trades`, label: 'Закрытые сделки' },
    { href: `${base}/holdings`, label: 'Heatmap холдингов' },
    { href: `${base}/backtest`, label: 'Бэктест' },
  ];
  return (
    <div className="si-tabs">
      <Link href="/superinvestor" className="si-tab">← Лидерборд</Link>
      {tabs.map(t => (
        <Link key={t.href} href={t.href} className={`si-tab ${path === t.href ? 'on' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
