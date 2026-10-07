import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  MIN_LENGTH,
  SIGNUP_COOKIE,
  isOpenMode,
  landingForSession,
  manualSignupOpen,
  signupScreenFor,
  socialProviders,
  type OidcProviderId,
} from "../../src/contexts/auth/index.ts";
import { CV_PDF_MAX_MB, HEADLINE_MAX, NAME_MAX } from "../../src/core/candidate-identity.ts";
import { renderSession } from "../auth";
import { getTranslator } from "../i18n";
import { TransitionLink } from "../transition-link";
import { completeSocialSignup, startManualSignup } from "./actions";
import { signupLimits, signupMessages } from "./messages";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

/**
 * Cadastro em tela única (#464, ADR-007): formulário e painel da marca.
 *
 * Público por desenho — quem chega aqui ainda não tem conta. O cookie do
 * cadastro decide o modo: pendência social válida mostra o e-mail que o
 * provedor confirmou (US-004.AC-1); sem ela, o formulário manual (E2E-012).
 * Quem já entrou vai para a própria tela, como em `/login`.
 */
export default async function SignupPage() {
  const { t } = await getTranslator();
  const session = isOpenMode() ? null : await renderSession();
  if (session !== null) redirect(landingForSession(session, null) as Route);

  const token = (await cookies()).get(SIGNUP_COOKIE)?.value ?? null;
  const screen = await signupScreenFor(token);
  const social = screen.mode === "manual" ? socialProviders() : [];
  const manualOpen = manualSignupOpen();
  const providerName = (id: OidcProviderId) => (id === "google" ? t("email.providerGoogle") : t("email.providerLinkedin"));
  const startHref = (id: OidcProviderId) => `/login/oauth/${id}`;

  const labels = {
    roleLegend: t("signup.roleLegend"),
    roleCandidate: t("signup.roleCandidate"),
    roleCandidateHint: t("signup.roleCandidateHint"),
    roleRecruiter: t("signup.roleRecruiter"),
    roleRecruiterHint: t("signup.roleRecruiterHint"),
    name: t("signup.name"),
    headline: t("onboarding.headline"),
    headlineHint: t("signup.headlineHint"),
    cv: t("signup.cv"),
    cvHint: t("signup.cvHint"),
    cvPdf: t("signup.cvPdf"),
    cvPdfHint: t("signup.cvPdfHint", { max: CV_PDF_MAX_MB }),
    email: t("signup.email"),
    password: t("signup.password"),
    passwordHint: t("signup.passwordHint", { min: MIN_LENGTH }),
    verifiedEmail: screen.mode === "social" ? t("signup.verifiedEmail", { provider: providerName(screen.provider) }) : "",
    acceptLead: t("signup.acceptLead"),
    terms: t("legal.terms"),
    acceptAnd: t("signup.acceptAnd"),
    privacy: t("legal.privacy"),
    submit: screen.mode === "social" ? t("signup.submitSocial") : t("signup.submit"),
  };
  const limits = { nameMax: NAME_MAX, headlineMax: HEADLINE_MAX, passwordMin: MIN_LENGTH };
  const messages = signupMessages(t, signupLimits);

  return (
    <main
      className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)] lg:items-start"
      data-testid="route-signup"
    >
      <section className="min-w-0">
        <h1 className="type-display-md chevron mb-2">{t("signup.title")}</h1>
        <p className="type-body-md mb-6 max-w-[62ch] text-muted-foreground">
          {screen.mode === "social" ? t("signup.socialLead") : t("signup.lead")}
        </p>

        {screen.mode === "manual" && screen.socialExpired && (
          <p className="type-body-sm mb-4 text-[var(--color-alert)]" role="alert" data-testid="signup-social-expired">
            {t("signup.errorExpired")}
          </p>
        )}

        {screen.mode === "manual" && screen.pendingCodeEmail !== null && (
          <p className="type-body-sm mb-4 rounded-[var(--radius-action)] bg-[var(--muted)] p-3" data-testid="signup-pending-code">
            {t("signup.haveCodeLead")} <strong data-user-content>{screen.pendingCodeEmail}</strong>.{" "}
            <TransitionLink
              href="/signup/verify"
              className="text-[var(--primary-text)] underline"
              data-testid="signup-have-code"
            >
              {t("signup.haveCode")}
            </TransitionLink>
          </p>
        )}

        {/* Mesmos links de `/login`: o início do login social é um GET que sai
            para o provedor (ADR-012); e-mail sem conta volta para cá no modo
            social. Fora de produção e local, o bloco some (ADR-005). */}
        {social.length > 0 && (
          <div className="mb-5 grid gap-2" data-testid="signup-social">
            {social.map((id) => (
              <a
                key={id}
                href={startHref(id)}
                data-testid={`signup-social-${id}`}
                className={buttonVariants({ variant: "outline", size: "lg", className: "w-full gap-2" })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- marca estática, sem otimização */}
                <img src={`/icons/${id}.svg`} alt="" width={18} height={18} />
                {t("login.continueWith", { provider: providerName(id) })}
              </a>
            ))}
            {manualOpen && <p className="type-body-sm mt-2 text-center text-muted-foreground">{t("signup.orManual")}</p>}
          </div>
        )}

        <Card className="w-full">
          <CardContent>
            {screen.mode === "social" ? (
              <SignupForm
                mode="social"
                action={completeSocialSignup}
                labels={labels}
                messages={messages}
                verifiedEmail={screen.email}
                limits={limits}
              />
            ) : manualOpen ? (
              <SignupForm
                mode="manual"
                action={startManualSignup}
                labels={labels}
                messages={messages}
                verifiedEmail={null}
                limits={limits}
              />
            ) : (
              <p className="type-body-md" data-testid="signup-unavailable">
                {t("signup.unavailable")}
              </p>
            )}
          </CardContent>
        </Card>

        <p className="type-body-sm mt-5 text-muted-foreground">
          {t("signup.haveAccount")}{" "}
          <TransitionLink href="/login" className="text-[var(--primary-text)] underline" data-testid="signup-sign-in">
            {t("signup.signIn")}
          </TransitionLink>
        </p>
      </section>

      {/* Painel da marca (padrão da Tecla, ADR-007): ao lado do formulário na
          tela larga, embaixo dele na estreita. Texto do produto, sem imagem de
          terceiros. */}
      <section
        className="min-w-0 rounded-[var(--radius-surface)] border border-[var(--hairline)] bg-[var(--muted)] p-6"
        data-testid="signup-brand"
      >
        <p className="type-display-sm mb-3">{t("signup.brandTitle")}</p>
        <p className="type-body-md mb-4">{t("signup.brandBody")}</p>
        <ul className="type-body-sm grid gap-2 text-muted-foreground">
          <li>{t("signup.brandCandidate")}</li>
          <li>{t("signup.brandRecruiter")}</li>
        </ul>
      </section>
    </main>
  );
}
