import type { Metadata } from 'next';
import '@/components/ui/tokens.css';
// Переиспользуем стили HTML-блоков результата (table()/kpi/callout/heat/код) — они скоупены
// под .research-output, тем же враппером оборачиваем вывод и здесь.
import '../research/research.css';

export const metadata: Metadata = {
  title: 'Тестирование стратегий',
  description: 'Событийный движок бэктеста: пишешь on_bar, учитываются издержки по типу рынка, плечо и шорты.',
};

export default function BacktestLayout({ children }: { children: React.ReactNode }) {
  return <div className="fk-root fk-page">{children}</div>;
}
