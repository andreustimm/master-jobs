import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SessionBadge } from "./session-badge";
import "./globals.css";

export const metadata: Metadata = {
  title: "job-hunt-os",
  description: "Sourcing, ranqueamento e funil de candidaturas",
};

/**
 * Without this, a phone renders the page at an assumed 980px and scales it
 * down — every breakpoint below `lg` never fires, and the whole responsive
 * stylesheet is dead code on the one device it was written for.
 *
 * `maximumScale` is deliberately not set: capping zoom is an accessibility
 * failure, and this app is read by someone who will be squinting at job
 * descriptions on a phone.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const navClass =
  "shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground";

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
      {/*
        Extensões de navegador injetam atributos no <body> antes da hidratação —
        Grammarly grava `data-gr-ext-installed`, entre outras. O React compara o
        HTML do servidor com o DOM do cliente, encontra a diferença e reporta
        mismatch de hidratação. O aviso é legítimo em geral, mas aqui a causa é
        externa à aplicação e não há correção do nosso lado.

        `suppressHydrationWarning` vale só para os atributos deste elemento e
        não desce para os filhos, então continuamos vendo qualquer mismatch de
        verdade dentro da árvore.
      */}
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        <TooltipProvider>
          <header className="border-b bg-card">
            {/* The nav scrolls sideways on a narrow screen rather than wrapping
                into a second row that pushes the content down, or collapsing
                into a hamburger that hides five links behind a tap. Five items
                fit in a swipe. */}
            <nav
              className={cn(
                "mx-auto flex h-14 max-w-[1140px] items-center gap-5 overflow-x-auto px-4",
                "sm:gap-7 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
            >
              <span className="shrink-0 font-mono text-sm font-medium tracking-tight">
                job-hunt-os
              </span>
              {/* Written out rather than mapped: `typedRoutes` validates each
                  href against the real route tree, and a mapped union defeats
                  exactly that check. */}
              <div className="flex shrink-0 gap-5">
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
                <Link href="/candidate" className={navClass}>
                  Candidato
                </Link>
              </div>
              {/* Pushed right, so the mode is visible without hunting for it.
                  An auth mode you cannot see is an auth mode you assume. */}
              <div className="ml-auto shrink-0">
                <SessionBadge />
              </div>
            </nav>
          </header>
          <div className="mx-auto max-w-[1140px] px-4 pb-24 sm:px-6">{children}</div>
        </TooltipProvider>
      </body>
    </html>
  );
}
