import type { Route } from "next";
import { redirect } from "next/navigation";
import { TransitionLink } from "../transition-link";
import { ClearCachesOnLogout } from "./clear-caches";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  isOidcProvider,
  isOpenMode,
  landingForSession,
  socialProviders,
  type OidcProviderId,
} from "../../src/contexts/auth/index.ts";
import type { Translator } from "../../src/core/i18n/index.ts";
import { renderSession } from "../auth";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslator } from "../i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordLoginAction } from "./actions";
import { LoginTransitionBoundary } from "./transition-boundary";

export const dynamic = "force-dynamic";

/**
 * A mensagem de um retorno do login social (#464). Código desconhecido com
 * provedor é tratado como tentativa vencida: ninguém chega aqui com outro
 * código sem ter mexido na URL.
 */
function socialErrorMessage(
  t: Translator["t"],
  code: string | undefined,
  provider: string,
  other: string,
): string | null {
  switch (code) {
    case undefined:
    case "":
      return null;
    case "cancelled":
      return t("login.socialCancelled");
    case "provider":
      return t("login.socialProvider", { provider });
    case "conflict":
      return t("login.socialConflict", { provider });
    case "unverified":
      return t("login.socialUnverified", { provider, other });
    case "refused":
      return t("login.socialRefused");
    case "rate_limited":
      return t("login.rateLimited");
    case "unavailable":
      return t("login.socialUnavailable");
    default:
      return t("login.socialExpired");
  }
}

/**
 * Magic-link landing page.
 *
 * `jho auth login <email>` prints a link here. This route redeems the token
 * once, sets the session cookie, and sends the person on. The token is
 * single-use: reloading this page with the same token fails, which is the
 * point — a link that stays valid is a credential sitting in shell history.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; cleared?: string; reset?: string; provider?: string; next?: string }>;
}) {
  // In single-user mode there is nobody to authenticate against.
  // Sem nenhuma conta cadastrada, um formulário de login é um beco sem saída:
  // não há o que digitar e nada na tela diz como sair disso. Mostra o caminho.
  const { getDb } = await import("../../src/core/db/client.ts");
  const { authUser } = await import("../../src/core/db/schema.ts");
  const accounts = await getDb().select({ id: authUser.id }).from(authUser).limit(1);
  const { t } = await getTranslator();

  if (accounts.length === 0) {
    return (
      <main className="flex min-h-[70vh] flex-col items-center justify-center py-16" data-testid="route-login">
        <LoginTransitionBoundary />
        <h1 className="type-display-md chevron mb-4">{t("login.firstAccess")}</h1>
        <Card className="w-full max-w-[46ch]">
          <CardContent className="pt-0">
            <p className="type-body-md">
              {t("login.noAccounts")}
            </p>
            <pre className="type-mono-sm mt-3 overflow-x-auto rounded-[var(--radius-surface)] bg-[var(--muted)] p-3">
{`pnpm jho auth add-user ${"seu@email.com"} --role admin,candidate
pnpm jho auth set-password ${"seu@email.com"}`}
            </pre>
            <p className="type-body-sm mt-4 text-muted-foreground">
              {t("login.afterCreate")}
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { error, cleared, provider, next } = await searchParams;

  // Quem já entrou não tem o que fazer aqui: vai para a tela do papel, ou para
  // o `next` seguro (US-001.EC-6). Sessão resolvida contra o banco — cookie
  // forjado ou revogado continua vendo o formulário.
  const session = isOpenMode() ? null : await renderSession();
  if (session !== null) redirect(landingForSession(session, next ?? null) as Route);

  const social = socialProviders();
  const providerName = (id: OidcProviderId) =>
    id === "google" ? t("email.providerGoogle") : t("email.providerLinkedin");

  // Erro vindo do login social traz `provider`: a mesma palavra (`unavailable`,
  // `rate_limited`) descreve outra coisa no login por senha.
  //
  // `unavailable` sem provedor tem mensagem própria porque descreve outra
  // coisa: o verificador não rodou, e a senha digitada pode estar perfeitamente
  // certa. Cair no "e-mail ou senha incorretos" mandaria a pessoa trocar uma
  // senha que não tem problema nenhum — e o suporte procuraria junto.
  const message = isOidcProvider(provider)
    ? socialErrorMessage(t, error, providerName(provider), providerName(provider === "google" ? "linkedin" : "google"))
    : error === "missing"
      ? t("login.missing")
      : error === "rate_limited"
        ? t("login.rateLimited")
        : error === "unavailable"
          ? t("login.unavailable")
          : error
            ? t("login.invalid")
            : null;
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
  const startHref = (id: OidcProviderId) => `/login/oauth/${id}${nextQuery}`;

  return (
    // Centrado nos dois eixos: a tela de login não tem navegação nem conteúdo
    // ao redor, e um formulário encostado no canto de uma tela vazia parece
    // um erro de layout.
    <main className="flex min-h-[70vh] flex-col items-center justify-center py-16" data-testid="route-login">
      <LoginTransitionBoundary />
      {/* Depois do logout: pede ao service worker para esvaziar o cache
          privado. Ver a nota no componente sobre por que existe mesmo com o
          service worker não guardando página autenticada. */}
      {cleared === "1" && <ClearCachesOnLogout />}
      <h1 className="type-display-md chevron mb-4">{t("login.title")}</h1>

      <Card className="w-full max-w-[42ch]">
        <CardContent className="pt-0">
          {/* Links, e não formulário: o início do login social é um GET que
              sai para o provedor (ADR-012). Sem provedor disponível neste
              ambiente, o bloco inteiro some e a tela é a de sempre (US-014). */}
          {social.length > 0 && (
            <div className="mb-5 grid gap-2" data-testid="social-sign-in">
              {social.map((id) => (
                <a
                  key={id}
                  href={startHref(id)}
                  data-testid={`social-${id}`}
                  className={buttonVariants({ variant: "outline", size: "lg", className: "w-full gap-2" })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- marca estática, sem otimização */}
                  <img src={`/icons/${id}.svg`} alt="" width={18} height={18} />
                  {t("login.continueWith", { provider: providerName(id) })}
                </a>
              ))}
              <p className="type-body-sm mt-2 text-center text-muted-foreground">{t("login.socialDivider")}</p>
            </div>
          )}

          <form action={passwordLoginAction} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            {message && (
              <p className="type-body-sm text-[var(--color-alert)]" role="alert" data-testid="login-error">
                {message}
              </p>
            )}

            <Button type="submit" data-testid="login-submit">
              {t("login.submit")}
            </Button>
          </form>

          {/* Fora do formulário: dentro dele, Enter no campo de senha poderia
              acionar o link em vez de entrar. */}
          <TransitionLink
            href="/login/forgot"
            data-testid="forgot-password"
            className="mt-4 inline-block type-body-sm text-[var(--primary-text)] hover:underline"
          >
            {t("login.forgot")}
          </TransitionLink>

          <p className="type-body-sm mt-5 border-t border-[var(--color-hairline)] pt-4 text-muted-foreground">
            {t("login.magicLinkHint")}{" "}
            <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">
              pnpm jho auth login &lt;email&gt;
            </code>
          </p>
          <p className="type-body-sm mt-2 text-muted-foreground">
            {t("login.setPasswordHint")}{" "}
            <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">
              pnpm jho auth set-password &lt;email&gt;
            </code>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
