import type { Metadata } from "next";
import Link from "next/link";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "job-hunt-os",
  description: "Sourcing, ranqueamento e funil de candidaturas",
};

const navClass =
  "text-sm text-muted-foreground transition-colors hover:text-foreground";

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
      <body className="bg-background text-foreground antialiased">
        <TooltipProvider>
          <header className="border-b bg-card">
            <nav className="mx-auto flex h-14 max-w-[1140px] items-center gap-7 px-6">
              <span className="font-mono text-sm font-medium tracking-tight">job-hunt-os</span>
              {/* Written out rather than mapped: `typedRoutes` validates each
                  href against the real route tree, and a mapped union defeats
                  exactly that check. */}
              <div className="flex gap-5">
                <Link href="/" className={navClass}>
                  Cockpit
                </Link>
                <Link href="/jobs" className={navClass}>
                  Vagas
                </Link>
                <Link href="/pipeline" className={navClass}>
                  Funil
                </Link>
                <Link href="/referrals" className={navClass}>
                  Referrals
                </Link>
              </div>
            </nav>
          </header>
          <div className="mx-auto max-w-[1140px] px-6 pb-24">{children}</div>
        </TooltipProvider>
      </body>
    </html>
  );
}
