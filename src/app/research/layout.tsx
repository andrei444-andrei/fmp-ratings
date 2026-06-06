import type { Metadata } from 'next';
import '@/components/ui/tokens.css';
import './research.css';

export const metadata: Metadata = {
  title: 'Исследование трендов',
  description: 'AI-исследователь трендов: промт → Python → результат в HTML.',
};

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return <div className="fk-root fk-page">{children}</div>;
}
