import '@/app/heatmap/heatmap.css';
import './superinvestor.css';
import DarkBody from './_components/DarkBody';

export const metadata = {
  title: 'Superinvestors — copy-α vs SPY',
};

export default function SuperinvestorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="si-root">
      <DarkBody />
      <div className="si-inner">{children}</div>
    </div>
  );
}
