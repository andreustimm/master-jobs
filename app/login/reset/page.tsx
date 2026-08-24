import { TransitionLink } from "../../transition-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTranslator } from "../../i18n";
import { resetTokenIsLive } from "../../../src/contexts/auth/index.ts";
import { submitResetAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Definir a senha nova.
 *
 * O token vem da URL e viaja num campo oculto. Não é segredo desta página — ele
 * já esteve na barra de endereços — e a alternativa, guardá-lo num cookie,
 * criaria um estado a expirar sem ganho nenhum.
 *
 * "Link morto" e "senha curta" são mensagens diferentes de propósito: a
 * primeira exige pedir outro link, a segunda se corrige aqui mesmo. Uma
 * mensagem só para os dois faria a pessoa pedir link novo por ter digitado uma
 * senha curta.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { t } = await getTranslator();
  const { token = "", error } = await searchParams;

  // Confere o token ANTES de mostrar o campo. Sem isto a pessoa digita a senha
  // nova, envia, e só então descobre que o link morreu — e como "link morto" e
  // "senha curta" pedem ações diferentes, ela acabaria pedindo outro link por
  // ter digitado uma senha curta.
  const dead = error === "invalid" || token === "" || !(await resetTokenIsLive(token));

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-[26rem] flex-col justify-center py-16" data-testid="route-login-reset">
      <h1 className="type-display-sm mb-2">{t("login.resetTitle")}</h1>

      {dead ? (
        <p role="alert" className="type-body-md text-[var(--bad)]">
          {t("login.resetInvalid")}
        </p>
      ) : (
        <>
          <p className="type-body-sm mb-6 text-muted-foreground">{t("login.resetLead")}</p>
          {error === "weak" && (
            <p role="alert" className="type-body-sm mb-3 text-[var(--bad)]">
              {t("login.resetWeak")}
            </p>
          )}
          <form action={submitResetAction} className="grid gap-4">
            <input type="hidden" name="token" value={token} />
            <div className="grid gap-1.5">
              <Label htmlFor="password">{t("login.newPassword")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <Button type="submit" data-testid="submit-reset">
              {t("login.resetSubmit")}
            </Button>
          </form>
        </>
      )}

      <TransitionLink href="/login" className="mt-6 type-body-sm text-[var(--primary-text)] hover:underline">
        ← {t("nav.signIn")}
      </TransitionLink>
    </main>
  );
}
