import type { Metadata } from 'next';
import '@/components/ui/tokens.css';

export const metadata: Metadata = {
  title: 'UX Kit — финансовые рынки',
  description: 'Светлый финтех UX-кит: палитра, типографика и компоненты.',
};

// Оборачиваем витрину в .fk-root (токены/шрифт) + .fk-page (полноэкранный
// светлый фон поверх тёмного легаси-шелла). Легаси-страницы не затрагиваются.
export default function KitLayout({ children }: { children: React.ReactNode }) {
  return <div className="fk-root fk-page">{children}</div>;
}
