import type { Metadata, Viewport } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SessionBadge } from "./session-badge";
import "./globals.css";
import "./themes.css";
import { cookies } from "next/headers";
import {
  MODE_COOKIE,
  MODES,
  modeAttribute,
  resolveMode,
  resolveTheme,
  THEME_COOKIE,
  THEMES,
} from "../src/core/theme.ts";
import pkg from "../package.json" with { type: "json" };
import { versaoAtual } from "../src/core/changelog.ts";
import {
  renderNavigationTransitionCSS,
  renderSplashCSS,
  renderSplashHTML,
  renderSplashScript,
} from "../src/core/pwa/splash.ts";
import { renderStandaloneScript } from "../src/core/pwa/standalone.ts";
import { Footer } from "./footer";
import { AppearanceSwitch } from "./theme-switch";
import { ServiceWorkerRegister } from "./service-worker";
import { stopImpersonatingAction } from "./admin/actions";
import { LocaleSwitch } from "./locale-switch";
import { NavLinks } from "./nav-links";
import { MobileNav } from "./mobile-nav";
import { NavigationTransition } from "./navigation-transition";
import { MutationFeedbackForm, MutationFeedbackHost } from "./mutation-feedback";
import {
  MUTATION_FEEDBACK_COOKIE,
  readMutationFeedbackCookie,
} from "./mutation-feedback-server";
import { headers } from "next/headers";
import {
  LOCALE_COOKIE,
  isLocale,
  negotiateLocale,
  translator,
} from "../src/core/i18n/index.ts";

export const metadata: Metadata = {
  title: "Master Jobs",
  description: "Sourcing, ranqueamento e funil de candidaturas",
  manifest: "/manifest.json",
  // Instalado no celular, a barra de status usa isto. `appleWebApp` porque o
  // iOS ignora o manifest para tela cheia e lê a meta própria dele.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Master Jobs" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
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
/**
 * A cor da barra do navegador, em hexadecimal literal.
 *
 * Único lugar do projeto onde cor não vem de token, e não é descuido: uma
 * `<meta>` é lida pelo sistema operacional antes de existir CSS, então `var()`
 * não resolve ali. Os valores espelham `--background` do tema `hp` em cada
 * modo, que é o padrão — e por isso vivem numa constante nomeada, para a
 * ligação ficar escrita em vez de subentendida.
 */
const THEME_COLOR = [
  { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  { media: "(prefers-color-scheme: dark)", color: "#101215" },
];

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Duas, porque o sistema tem tema claro e escuro e a barra do navegador
  // precisa acompanhar. Uma cor fixa deixaria a barra escura sobre uma
  // interface clara — o oposto do que o eixo de aparência existe para fazer.
  themeColor: THEME_COLOR,
};

/**
 * Link de navegação.
 *
 * `py-2.5` existe pelo alvo de toque, não pelo espaçamento: o texto sozinho
 * dava 20px de altura, bem abaixo do mínimo confortável no celular. A área
 * clicável cresce sem que nada se mexa visualmente, porque a barra já tem
 * altura fixa.
 */
const navClass =
  "flex shrink-0 items-center py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Lido no servidor para o tema já vir certo no primeiro byte. Resolver isso
  // no cliente produziria o flash branco clássico de quem escolheu localStorage.
  const jar = await cookies();
  const theme = resolveTheme(jar.get(THEME_COOKIE)?.value);
  const mode = resolveMode(jar.get(MODE_COOKIE)?.value);
  const { currentSession } = await import("./auth");
  const session = await currentSession();
  const signedIn = Boolean(session);
  // `=== true` porque `session?.roles.includes(...)` é `boolean | undefined`, e
  // `undefined` num `&&` de JSX simplesmente não renderiza — o que funcionava.
  // Agora o valor atravessa uma fronteira de componente, onde "ausente" e
  // "falso" precisam ser a mesma coisa.
  const hasCandidateScope =
    session?.candidateId !== null && session?.roles.includes("candidate") === true;
  // Admin de verdade: papel `admin` E sessão própria. Numa sessão emprestada a
  // política nega administração, e um link que leva a uma página que vai negar
  // é pior que link nenhum.
  const isAdmin = session?.roles.includes("admin") === true && session.impersonatedBy === null;
  const borrowedAs = session && session.impersonatedBy !== null ? session.email : null;

  // Escolha gravada primeiro; sem ela, negocia pelo Accept-Language. Servir
  // português a quem pediu inglês no navegador é ignorar informação que já
  // temos.
  const saved = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved)
    ? saved
    : negotiateLocale((await headers()).get("accept-language"));
  const { t } = translator(locale);
  const mutationFeedback = readMutationFeedbackCookie(jar.get(MUTATION_FEEDBACK_COOKIE)?.value);

  return (
    // `data-mode` fica ausente em `system` — é a ausência que devolve a decisão
    // para a `prefers-color-scheme`.
    //
    // `suppressHydrationWarning` aqui pelo mesmo motivo do `<body>` lá embaixo,
    // mas com uma fonte própria: o script inline de `renderStandaloneScript`
    // adiciona `pwa-standalone` ao `document.documentElement` ANTES da
    // hidratação quando o app roda instalado. O servidor não sabe que é PWA e
    // renderiza sem a classe; o React hidrata e vê a diferença. É mutação
    // intencional de atributo, não defeito — vale só para este elemento e não
    // desce para os filhos.
    <html lang={locale} data-theme={theme} data-mode={modeAttribute(mode)} suppressHydrationWarning>
      <head>
        {/* Antes de tudo: marca o modo instalado para o CSS de área segura
            valer já na primeira pintura. Depois da primeira pintura, o
            cabeçalho nasceria colado no topo e desceria — um salto visível. */}
        <script dangerouslySetInnerHTML={{ __html: renderStandaloneScript() }} />
        <style
          dangerouslySetInnerHTML={{
            __html: `${renderSplashCSS()}${renderNavigationTransitionCSS()}`,
          }}
        />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
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
        {/* Primeiro filho do body, e removida por script inline.

            Cobre o intervalo entre o documento chegar e a folha de estilo e a
            fonte ficarem prontas — que num app instalado é pior que no
            navegador: a splash do sistema some, entrega tela vazia, e só então
            o conteúdo aparece. Um componente React chegaria depois exatamente
            do intervalo que deveria cobrir, além de exigir bundle de cliente
            numa árvore que não tem nenhum. */}
        <div dangerouslySetInnerHTML={{ __html: renderSplashHTML(t("splash.loading")) }} />
        <script dangerouslySetInnerHTML={{ __html: renderSplashScript() }} />

        <NavigationTransition
          labels={{
            loading: t("transition.loading"),
            prolonged: t("transition.prolonged"),
            offlineTitle: t("transition.offlineTitle"),
            offlineBody: t("transition.offlineBody"),
            retry: t("transition.retry"),
            failedTitle: t("transition.failedTitle"),
            failedBody: t("transition.failedBody"),
          }}
        />

        <MutationFeedbackHost
          initial={
            mutationFeedback
              ? {
                  id: mutationFeedback.id,
                  kind: mutationFeedback.kind,
                  message:
                    mutationFeedback.message === "success"
                      ? t("feedback.success")
                      : t("feedback.error"),
                }
              : null
          }
          dismissLabel={t("feedback.dismiss")}
        />

        <div id="application-shell">
          <ServiceWorkerRegister />
          <TooltipProvider>
          <header className="border-b bg-card">
            {/*
              Três faixas: marca, links roláveis, e o estado da sessão.

              A rolagem lateral fica SÓ nos links, e o `min-w-0` é o que a faz
              funcionar — sem ele um flex item não encolhe abaixo do próprio
              conteúdo, o container cresce e quem rola passa a ser a página
              inteira. Era 100px de rolagem horizontal em 375px, invisível no
              desktop e só detectável medindo `scrollWidth` num browser real.
            */}
            <div className="mobile-content-shell mx-auto flex min-h-14 w-full max-w-[min(95vw,1760px)] sm:max-w-[min(90vw,1760px)] items-center gap-4 px-4 sm:gap-6 sm:px-6">
              <span className="shrink-0 font-mono text-sm font-medium tracking-tight">
                Master Jobs
              </span>

              {/* Sem sessão os links levariam de volta ao login; mostrar um
                  menu que não vai a lugar nenhum é ruído. */}
              {/* A fileira ou o menu compacto são escolhidos pelo espaço real
                  que sobra entre a marca e os controles. Assim uma janela
                  estreita num monitor e um telefone em paisagem têm o mesmo
                  comportamento, sem um breakpoint arbitrário. */}
              <nav
                data-responsive-nav
                className={cn(
                  "min-w-0 flex-1 items-center gap-5 overflow-x-auto",
                  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  !signedIn && "invisible",
                )}
              >
                <NavLinks
                  hasCandidateScope={hasCandidateScope}
                  isAdmin={isAdmin}
                  linkClass={navClass}
                  t={t}
                />
              </nav>

              {/* No modo compacto, ocupa o espaço entre a marca e os controles;
                  no modo completo, o CSS remove este spacer. */}
              <div data-responsive-nav-spacer className="flex-1" />

              {signedIn && (
                <MobileNav
                  hasCandidateScope={hasCandidateScope}
                  isAdmin={isAdmin}
                  rotulo={t("nav.menu")}
                  locale={locale}
                />
              )}

              <div data-header-controls className="flex shrink-0 items-center gap-2">
                <LocaleSwitch current={locale} label={t("nav.language")} />
                <AppearanceSwitch
                  theme={theme}
                  mode={mode}
                  labels={{
                    appearance: t("theme.appearance"),
                    trigger: t("nav.appearance"),
                    theme: t("theme.title"),
                    environment: t("theme.environment"),
                    themeDescription: Object.fromEntries(
                      THEMES.map((item) => [item.id, t(item.description)]),
                    ),
                    modeLabel: Object.fromEntries(MODES.map((m) => [m.id, t(m.label)])),
                  }}
                />
                <SessionBadge />
              </div>
            </div>
          </header>

          {/* Faixa de sessão emprestada.
              Fica ACIMA de tudo e em cor de alerta de propósito: operar como
              outra pessoa sem perceber é como se escreve no dado errado. O
              texto nomeia quem, porque "modo admin" não diz de quem é a sessão. */}
          {borrowedAs && (
            <div className="border-b border-[var(--warn)] bg-[var(--warn)]/10">
              <div className="mobile-content-shell mx-auto flex w-full max-w-[min(95vw,1760px)] sm:max-w-[min(90vw,1760px)] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 sm:px-6">
                <span className="type-body-sm font-medium text-[var(--warn)]">
                  {t("impersonation.banner", { email: borrowedAs })}
                </span>
                <span className="type-meta text-muted-foreground">
                  {t("impersonation.note")}
                </span>
                <MutationFeedbackForm
                  action={stopImpersonatingAction}
                  successMessage={t("feedback.success")}
                  errorMessage={t("feedback.error")}
                  dismissLabel={t("feedback.dismiss")}
                  className="ml-auto"
                >
                  <button
                    type="submit"
                    data-testid="stop-impersonating"
                    className="cursor-pointer type-body-sm font-medium text-[var(--warn)] underline-offset-2 hover:underline"
                  >
                    {t("impersonation.exit")}
                  </button>
                </MutationFeedbackForm>
              </div>
            </div>
          )}
          {/* 95% no celular aproveita a largura curta sem encostar no vidro;
              em telas maiores, 90% preserva a medida confortável e o teto. */}
          <div className="mobile-content-shell mx-auto w-full max-w-[min(95vw,1760px)] sm:max-w-[min(90vw,1760px)] px-4 pb-16 sm:px-6">
            {children}
          </div>
          {/* `pb-16` acima em vez de `pb-24`: o rodapé passou a fechar a página,
              e o respiro que aquele espaço dava agora vem dele. */}
            <Footer versao={versaoAtual(pkg)} locale={locale} t={t} />
          </TooltipProvider>
        </div>
      </body>
    </html>
  );
}
