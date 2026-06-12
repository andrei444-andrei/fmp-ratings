import type { Metadata } from 'next';
import './globals.css';
import Nav from './_components/Nav';

export const metadata: Metadata = {
  title: 'Market Lab — исследование трендов и аналитика алгоритмов',
  description: 'Python-исследование рыночных данных и годовая аналитика QuantConnect-алгоритмов.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=(t==='dark'?'dark':'light');}catch(e){document.documentElement.dataset.theme='light';}})();",
          }}
        />
      </head>
      <body className="app-body antialiased">
        <Nav />
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
