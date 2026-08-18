import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "job-hunt-os",
  description: "Sourcing, ranqueamento e funil de candidaturas",
};

const navLink = { color: "var(--text-2)", textDecoration: "none" } as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <header style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
          <nav
            style={{
              maxWidth: 1140,
              margin: "0 auto",
              padding: "0 24px",
              display: "flex",
              alignItems: "center",
              gap: 28,
              height: 56,
            }}
          >
            <span className="mono" style={{ fontWeight: 500, letterSpacing: "-.01em" }}>
              job-hunt-os
            </span>
            {/* Written out rather than mapped: `typedRoutes` validates each
                href against the real route tree, and a mapped union defeats
                that check — which is the whole point of the flag. */}
            <div style={{ display: "flex", gap: 20, fontSize: 14 }}>
              <Link href="/" style={navLink}>
                Cockpit
              </Link>
              <Link href="/jobs" style={navLink}>
                Vagas
              </Link>
              <Link href="/pipeline" style={navLink}>
                Funil
              </Link>
              <Link href="/referrals" style={navLink}>
                Referrals
              </Link>
            </div>
          </nav>
        </header>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 24px 96px" }}>{children}</div>
      </body>
    </html>
  );
}
