import './quant.css';

export const metadata = {
  title: 'Аналитика алгоритмов — QuantConnect',
};

export default function QuantLayout({ children }: { children: React.ReactNode }) {
  return <div className="qc-root">{children}</div>;
}
