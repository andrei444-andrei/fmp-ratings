import type { Metadata } from 'next';
// Переиспользуем дизайн-кит скринера (.rsx, токены --fk-*) + локальные дополнения раздела.
import '../researcher/researcher.css';
import './portfolios.css';

export const metadata: Metadata = {
  title: 'Портфели',
  description: 'Объединение сетапов в стратегию: загрузка, доходность/альфа на загрузку, Sharpe и просадка против S&P 500.',
};

export default function PortfoliosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
