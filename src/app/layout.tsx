import type { Metadata } from 'next';
import './globals.css';
import Nav from './_components/Nav';

export const metadata: Metadata = {
  title: 'Market Lab — heatmap, superinvestors, AI events',
  description: 'Дневной хитмап рынка, копи-альфа суперинвесторов и AI-исследователь событий.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=(t==='light'?'light':'dark');}catch(e){document.documentElement.dataset.theme='dark';}})();",
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
