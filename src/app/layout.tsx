import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArbPoly",
  description: "Read-only Kalshi and Polymarket arbitrage scanner"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">ArbPoly</div>
            <nav className="nav" aria-label="Primary navigation">
              <Link href="/">Dashboard</Link>
              <Link href="/pairs">Pair Review</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/api/health">Health JSON</Link>
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
