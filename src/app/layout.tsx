import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Low on Legs',
  description: 'Organizacja amatorskich lig tenisowych',
};

export const runtime = 'nodejs';

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl">
      <body>
        <nav className="site-nav" aria-label="Główna nawigacja">
          <Link className="brand" href="/">
            Low on Legs
          </Link>
          <div className="nav-links">
            <Link href="/players">Gracze</Link>
            <Link href="/leagues">Ligi</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
