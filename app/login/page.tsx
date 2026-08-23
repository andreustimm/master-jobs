import Link from "next/link";
import { ClearCachesOnLogout } from "./clear-caches";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslator } from "../i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordLoginAction } from "./actions";

export const dynamic = "force-dynamic";

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
  searchParams: Promise<{ error?: string; cleared?: string; reset?: string }>;
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
      <main className="flex min-h-[70vh] flex-col items-center justify-center py-16">
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

  const { error, cleared } = await searchParams;

  // `unavailable` tem mensagem própria porque descreve outra coisa: o
  // verificador não rodou, e a senha digitada pode estar perfeitamente certa.
  // Cair no "e-mail ou senha incorretos" mandaria a pessoa trocar uma senha que
  // não tem problema nenhum — e o suporte procuraria junto.
  const message =
    error === "missing"
      ? t("login.missing")
      : error === "rate_limited"
        ? t("login.rateLimited")
        : error === "unavailable"
          ? t("login.unavailable")
          : error
            ? t("login.invalid")
            : null;

  return (
    // Centrado nos dois eixos: a tela de login não tem navegação nem conteúdo
    // ao redor, e um formulário encostado no canto de uma tela vazia parece
    // um erro de layout.
    <main className="flex min-h-[70vh] flex-col items-center justify-center py-16">
      {/* Depois do logout: pede ao service worker para esvaziar o cache
          privado. Ver a nota no componente sobre por que existe mesmo com o
          service worker não guardando página autenticada. */}
      {cleared === "1" && <ClearCachesOnLogout />}
      <h1 className="type-display-md chevron mb-4">{t("login.title")}</h1>

      <Card className="w-full max-w-[42ch]">
        <CardContent className="pt-0">
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
              <p className="type-body-sm text-[var(--color-alert)]" role="alert">
                {message}
              </p>
            )}

            <Button type="submit" data-testid="login-submit">
              {t("login.submit")}
            </Button>
          </form>

          {/* Fora do formulário: dentro dele, Enter no campo de senha poderia
              acionar o link em vez de entrar. */}
          <Link
            href="/login/forgot"
            data-testid="forgot-password"
            className="mt-4 inline-block type-body-sm text-[var(--primary-text)] hover:underline"
          >
            {t("login.forgot")}
          </Link>

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
