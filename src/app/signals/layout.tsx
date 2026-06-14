import type { Metadata } from 'next';
import '@/components/ui/tokens.css';
// Переиспользуем стили HTML-блоков результата (table()/kpi/callout/heat) — они скоупены
// под .research-output, тем же враппером оборачиваем вывод и здесь.
import '../research/research.css';

export const metadata: Metadata = {
  title: 'Модель сигналов',
  description: 'Факторная модель: майнинг связей, значимость (FDR), веса, walk-forward OOS, live-скоринг.',
};

export default function SignalsLayout({ children }: { children: React.ReactNode }) {
  return <div className="fk-root fk-page">{children}</div>;
}
