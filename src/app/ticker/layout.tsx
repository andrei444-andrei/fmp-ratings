import '@/app/heatmap/heatmap.css';
import '@/app/superinvestor/superinvestor.css';
import './ticker.css';
import DarkBody from '@/app/superinvestor/_components/DarkBody';

export const metadata = {
  title: 'Тикер — доходность, события, summary',
};

export default function TickerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="si-root">
      <DarkBody />
      <div className="si-inner">{children}</div>
    </div>
  );
}
