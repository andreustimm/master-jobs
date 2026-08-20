import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTranslator } from "../../i18n";
import { requestResetAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Pedir o link de recuperação.
 *
 * A tela de confirmação é a MESMA para conta existente e inexistente, e a
 * mensagem é redigida para isso: "se existir uma conta com esse endereço". Uma
 * confirmação que dissesse "enviamos" afirmaria que a conta existe, e todo o
 * cuidado do lado do servidor teria sido desfeito pela redação.
 */
export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { t } = await getTranslator();
  const sent = (await searchParams).sent === "1";

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-[26rem] flex-col justify-center py-16">
      <h1 className="type-display-sm mb-2">{t("login.forgotTitle")}</h1>
      <p className="type-body-sm mb-6 text-muted-foreground">{t("login.forgotLead")}</p>

      {sent ? (
        <Card>
          <CardContent className="pt-0">
            <p className="type-body-md">{t("login.forgotSent")}</p>
          </CardContent>
        </Card>
      ) : (
        <form action={requestResetAction} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">{t("login.email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
          </div>
          <Button type="submit" data-testid="request-reset">
            {t("login.forgotSubmit")}
          </Button>
        </form>
      )}

      <Link href="/login" className="mt-6 type-body-sm text-[var(--primary-text)] hover:underline">
        ← {t("nav.signIn")}
      </Link>
    </main>
  );
}
