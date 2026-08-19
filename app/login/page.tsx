import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordLoginAction } from "./actions";
import { isSingleUser } from "../../src/contexts/auth/index.ts";

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
  searchParams: Promise<{ error?: string }>;
}) {
  // In single-user mode there is nobody to authenticate against.
  if (isSingleUser()) {
    return (
      <main className="pt-10 pb-16">
        <h1 className="type-display-md chevron mb-3">Login</h1>
        <Card className="max-w-[62ch]">
          <CardContent className="pt-0">
            <p className="type-body-md">
              O sistema está em <strong>modo single-user</strong> — sem login, porque não há
              contra quem autenticar: você, em loopback.
            </p>
            <p className="type-body-sm mt-3 text-muted-foreground">
              Toda ação ainda passa pelo mesmo guard de autorização; a sessão é sintetizada em
              vez de exigida. Para ativar o login de verdade, defina{" "}
              <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">
                JHO_AUTH_MODE=multi
              </code>{" "}
              no <code className="type-mono-sm">.env</code> e crie uma conta com{" "}
              <code className="type-mono-sm">pnpm jho auth add-user</code>.
            </p>
            <p className="type-body-sm mt-4">
              <Link href="/" className="text-primary hover:underline">
                ← voltar ao cockpit
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { error } = await searchParams;

  const message =
    error === "missing"
      ? "Informe e-mail e senha."
      : error === "rate_limited"
        ? "Tentativas demais. Espere alguns minutos."
        : error
          ? "E-mail ou senha incorretos."
          : null;

  return (
    <main className="pt-10 pb-16">
      <h1 className="type-display-md chevron mb-3">Entrar</h1>

      <Card className="max-w-[42ch]">
        <CardContent className="pt-0">
          <form action={passwordLoginAction} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">E-mail</Label>
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
              <Label htmlFor="password">Senha</Label>
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

            <Button type="submit">Entrar</Button>
          </form>

          <p className="type-body-sm mt-5 border-t border-[var(--color-hairline)] pt-4 text-muted-foreground">
            Sem senha definida? Um link de uso único também entra:{" "}
            <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">
              pnpm jho auth login &lt;email&gt;
            </code>
          </p>
          <p className="type-body-sm mt-2 text-muted-foreground">
            Definir senha:{" "}
            <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">
              pnpm jho auth set-password &lt;email&gt;
            </code>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
