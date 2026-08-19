import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  searchParams: Promise<{ error?: string }>;
}) {
  // In single-user mode there is nobody to authenticate against.
  // Sem nenhuma conta cadastrada, um formulário de login é um beco sem saída:
  // não há o que digitar e nada na tela diz como sair disso. Mostra o caminho.
  const { getDb } = await import("../../src/core/db/client.ts");
  const { authUser } = await import("../../src/core/db/schema.ts");
  const accounts = await getDb().select({ id: authUser.id }).from(authUser).limit(1);

  if (accounts.length === 0) {
    return (
      <main className="flex min-h-[70vh] flex-col items-center justify-center py-16">
        <h1 className="type-display-md chevron mb-4">Primeiro acesso</h1>
        <Card className="w-full max-w-[46ch]">
          <CardContent className="pt-0">
            <p className="type-body-md">
              Nenhuma conta cadastrada ainda. Crie a sua no terminal:
            </p>
            <pre className="type-mono-sm mt-3 overflow-x-auto rounded-[var(--radius-surface)] bg-[var(--muted)] p-3">
{`pnpm jho auth add-user ${"seu@email.com"} --role owner
pnpm jho auth set-password ${"seu@email.com"}`}
            </pre>
            <p className="type-body-sm mt-4 text-muted-foreground">
              Depois recarregue esta página. A senha é lida do terminal, nunca de
              argumento — argumento aparece no histórico do shell e em{" "}
              <code className="type-mono-sm">ps</code>.
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
    // Centrado nos dois eixos: a tela de login não tem navegação nem conteúdo
    // ao redor, e um formulário encostado no canto de uma tela vazia parece
    // um erro de layout.
    <main className="flex min-h-[70vh] flex-col items-center justify-center py-16">
      <h1 className="type-display-md chevron mb-4">Entrar</h1>

      <Card className="w-full max-w-[42ch]">
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
