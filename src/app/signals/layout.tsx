import type { Metadata } from 'next';
import '@/components/ui/tokens.css';

export const metadata: Metadata = {
  title: 'Модель сигналов',
  description: 'Исследование факторов, сигналов и их комбинаций: карты край × порог, событийный анализ, walk-forward автоподбор.',
};

export default function SignalsLayout({ children }: { children: React.ReactNode }) {
  return <div className="fk-root fk-page">{children}</div>;
}
