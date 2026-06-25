import type { Metadata } from 'next';
import '@/components/ui/tokens.css';

export const metadata: Metadata = {
  title: 'Переключение A/B',
  description:
    'Когда держать одну бумагу вместо другой: условная доходность A − B по состоянию факторов рынка/A/B. Авто-скан связей с защитой от переобучения (holdout-OOS + FDR) и ручной свип фактора.',
};

export default function SwitchLayout({ children }: { children: React.ReactNode }) {
  return <div className="fk-root fk-page">{children}</div>;
}
