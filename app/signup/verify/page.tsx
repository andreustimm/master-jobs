import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CODE_DIGITS,
  CODE_MAX_ATTEMPTS,
  CODE_MINUTES,
  RESEND_SECONDS,
  SIGNUP_COOKIE,
  isOpenMode,
  landingForSession,
  verifyScreenFor,
} from "../../../src/contexts/auth/index.ts";
import { renderSession } from "../../auth";
import { getTranslator } from "../../i18n";
import { TransitionLink } from "../../transition-link";
import { confirmSignupCode, resendSignupCode } from "../actions";
import { signupLimits, signupMessages } from "../messages";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

/**
 * "Confira seu e-mail" — a etapa do código do cadastro manual (#464, US-017).
 *
 * Pública por desenho: quem está aqui ainda não tem conta. A pendência vem do
 * cookie do cadastro, nunca da URL; sem pendência válida, a tela diz que o
 * cadastro expirou e leva de volta ao começo. A resposta é a mesma para e-mail
 * com e sem conta — no segundo caso o código simplesmente nunca confere
 * (US-016.EC-3).
 */
export default async function VerifySignupPage() {
  const { t } = await getTranslator();
  const session = isOpenMode() ? null : await renderSession();
  if (session !== null) redirect(landingForSession(session, null) as Route);

  const screen = await verifyScreenFor((await cookies()).get(SIGNUP_COOKIE)?.value ?? null);

  if (screen.state === "expired") {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center py-16" data-testid="route-signup-verify">
        <h1 className="type-display-md chevron mb-4">{t("signup.verifyExpiredTitle")}</h1>
        <Card className="w-full max-w-[46ch]">
          <CardContent>
            <p className="type-body-md mb-4" data-testid="verify-expired">
              {t("signup.verifyExpiredBody")}
            </p>
            <TransitionLink href="/signup" className={buttonVariants({ variant: "default" })} data-testid="verify-start-over">
              {t("signup.startOver")}
            </TransitionLink>
          </CardContent>
        </Card>
      </main>
    );
  }

  const messages = signupMessages(t, signupLimits);
  // Código vencido ou travado já na chegada: a tela diz o que fazer antes de a
  // pessoa digitar.
  const initialMessage = screen.attemptsLeft === 0
    ? t("signup.verifyLocked", { max: CODE_MAX_ATTEMPTS })
    : screen.codeExpired
      ? t("signup.verifyCodeExpired")
      : null;

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center py-16" data-testid="route-signup-verify">
      <h1 className="type-display-md chevron mb-4">{t("signup.verifyTitle")}</h1>
      <Card className="w-full max-w-[46ch]">
        <CardContent className="grid gap-4">
          <p className="type-body-md min-w-0 break-words">
            {t("signup.verifyLead", { digits: CODE_DIGITS })}{" "}
            <strong data-user-content data-testid="verify-email">
              {screen.email}
            </strong>
          </p>
          <p className="type-body-sm text-muted-foreground" data-testid="verify-expiry">
            {t("signup.verifyExpiry", { minutes: CODE_MINUTES })} {t("signup.verifySpam")}
          </p>
          <VerifyForm
            confirm={confirmSignupCode}
            resend={resendSignupCode}
            labels={{
              code: t("signup.verifyCode"),
              submit: t("signup.verifySubmit"),
              resend: t("signup.verifyResend"),
              resendIn: t("signup.verifyResendIn", { seconds: "{seconds}" }),
              resent: t("signup.verifyResent"),
            }}
            messages={{ ...messages, expired: t("signup.verifyCodeExpired") }}
            initialResendIn={screen.resendInSeconds}
            resendSeconds={RESEND_SECONDS}
            initialMessage={initialMessage}
          />
          <TransitionLink href="/signup" className="type-body-sm text-[var(--primary-text)] underline" data-testid="verify-start-over">
            {t("signup.startOver")}
          </TransitionLink>
        </CardContent>
      </Card>
    </main>
  );
}
