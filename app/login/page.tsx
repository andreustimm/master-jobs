import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <main className="pt-10 pb-16">
      <h1 className="type-display-md chevron mb-3">Login</h1>
      <Card className="max-w-[62ch]">
        <CardContent className="pt-0">
          {error ? (
            <>
              <p className="type-body-md text-[var(--color-alert)]">
                {error === "missing" ? "Link sem token." : "Link inválido ou já usado."}
              </p>
              <p className="type-body-sm mt-2 text-muted-foreground">
                Links são de uso único e expiram em 15 minutos. Um link que continua valendo é
                uma credencial parada no histórico do shell.
              </p>
            </>
          ) : (
            <p className="type-body-md">Abra o link que você recebeu para entrar.</p>
          )}
          <p className="type-body-sm mt-4 text-muted-foreground">
            Gere um novo com{" "}
            <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">
              pnpm jho auth login &lt;email&gt;
            </code>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
