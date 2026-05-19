import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FMP Ratings — Point-in-Time Rating Changes',
  description: 'Top-50 by market cap per year × analyst rating upgrades, без survivorship bias.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">FMP Ratings</h1>
            <nav className="text-sm text-neutral-600 space-x-3 mt-2">
              <a href="/" className="hover:underline">Pipeline</a>
              <a href="/results" className="hover:underline">Results</a>
              <a href="/eps" className="hover:underline">EPS Surprise</a>
              <a href="/signals" className="hover:underline">Signals</a>
              <a href="/heatmap" className="hover:underline">Heatmap</a>
              <a href="/market-events" className="hover:underline">Market Events</a>
              <a href="/admin" className="hover:underline">Admin / DB</a>
              <a href="https://github.com" className="hover:underline opacity-50" target="_blank">GitHub</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
