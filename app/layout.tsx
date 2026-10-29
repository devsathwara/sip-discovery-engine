import type { Metadata } from 'next';
import { Figtree, Newsreader } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const sans = Figtree({ subsets: ['latin'], variable: '--sans' });
const serif = Newsreader({ subsets: ['latin'], variable: '--serif' });

export const metadata: Metadata = {
  title: 'SIP continuation research',
  description: 'Public-comment labels for why an Indian mutual-fund SIP stops. Not investment advice.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable}`}>
        <div className="wrap">
          <header className="top">
            <Link className="brand" href="/">SIP discovery</Link>
            <span className="meta">Public comments. Not a fund recommendation.</span>
          </header>
          {children}
          <footer>Research analysis of public data. Not investment advice.</footer>
        </div>
      </body>
    </html>
  );
}
