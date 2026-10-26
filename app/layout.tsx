import type { Metadata } from 'next';
import { Figtree, Newsreader } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const sans = Figtree({ subsets: ['latin'], variable: '--sans' });
const serif = Newsreader({ subsets: ['latin'], variable: '--serif' });

export const metadata: Metadata = {
  title: 'SIP discovery engine',
  description: 'Collect a bounded Reddit search sample and read it with the original links.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable}`}>
        <div className="wrap">
          <header className="top">
            <Link className="brand" href="/">SIP discovery</Link>
            <span className="meta">Public search sample. Not all of Reddit.</span>
          </header>
          {children}
          <footer>Collected text stays attributed to its permalink. This tool does not recommend a product, fund, or stock.</footer>
        </div>
      </body>
    </html>
  );
}
