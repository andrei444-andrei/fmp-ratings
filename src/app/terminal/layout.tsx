import type { Metadata } from 'next';
import '@/components/ui/tokens.css';

export const metadata: Metadata = {
  title: 'Рыночный терминал',
  description: 'Что изменилось сейчас в мире и на рынках: режим рынка, доходности стран/секторов/металлов/корзин по периодам, относительная сила и аномалии.',
};

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return <div className="fk-root fk-page">{children}</div>;
}
