import type { Route } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isOpenMode, recruiterInvitePage } from "../../../src/contexts/auth/index.ts";
import { renderSession } from "../../auth";
import { getTranslator } from "../../i18n";
import { TransitionLink } from "../../transition-link";
import { acceptInviteAction, startInvitedSignup } from "./actions";

export const dynamic = "force-dynamic";

/**
 * O link do convite de recrutador (#465, ADR-018).
 *
 * Público por desenho — quem foi convidado ainda não tem conta. O token da URL
 * é procurado pelo hash; expirado, usado, substituído, cancelado, desconhecido
 * ou de candidato desabilitado dão a MESMA página neutra, byte a byte: nada
 * aqui revela se um convite existiu. Nenhum estado altera dado no GET — um
 * pré-carregador de links com cookie concederia sem ninguém pedir —, e com
 * sessão de outro endereço a página mostra só o endereço mascarado, nada do
 * candidato.
 */
export default async function SignupInvitePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { t } = await getTranslator();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : null;
  const session = isOpenMode() ? null : await renderSession();
  const state = await recruiterInvitePage(token, session);
  // Esta conta já aceitou (o login acabou de concluir): direto ao candidato.
  if (state.kind === "open") redirect(`/recruiter/${state.candidateId}` as Route);

  if (state.kind === "neutral") {
    return (
      <main className="flex min-h-[70vh] flex-col items-center justify-center py-16" data-testid="route-signup-invite">
        <Card className="w-full max-w-[46ch]" data-testid="invite-neutral">
          <CardContent className="grid gap-2">
            <h1 className="type-display-sm">{t("recruiterInvite.neutralTitle")}</h1>
            <p className="type-body-md text-muted-foreground">{t("recruiterInvite.neutralBody")}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const loginHref = `/login?next=${encodeURIComponent(`/signup/invite?token=${token ?? ""}`)}` as Route;

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center py-16" data-testid="route-signup-invite">
      <Card className="w-full max-w-[52ch]" data-testid={`invite-${state.kind.replace("_", "-")}`}>
        <CardContent className="grid min-w-0 gap-4">
          <h1 className="type-display-sm">{t("recruiterInvite.title")}</h1>

          {(state.kind === "anonymous" || state.kind === "accept") && (
            <dl className="type-body-md grid min-w-0 gap-1">
              <div className="min-w-0 break-words">
                <dt className="inline text-muted-foreground">{t("recruiterInvite.invitedBy")} </dt>
                <dd className="inline font-medium" data-user-content data-testid="invite-candidate">
                  {state.candidateName}
                </dd>
              </div>
              <div className="min-w-0 break-words">
                <dt className="inline text-muted-foreground">{t("recruiterInvite.expectedEmail")} </dt>
                <dd className="inline font-medium" data-user-content data-testid="invite-expected-email">
                  {state.maskedEmail}
                </dd>
              </div>
            </dl>
          )}

          {state.kind === "anonymous" && (
            <>
              <p className="type-body-sm text-muted-foreground">{t("recruiterInvite.anonymousLead")}</p>
              <form action={startInvitedSignup} className="grid">
                <input type="hidden" name="token" value={token ?? ""} />
                <Button type="submit" size="lg" data-testid="invite-create-account">
                  {t("recruiterInvite.createAccount")}
                </Button>
              </form>
              <TransitionLink
                href={loginHref}
                className="type-body-sm text-[var(--primary-text)] underline"
                data-testid="invite-sign-in"
              >
                {t("recruiterInvite.haveAccount")}
              </TransitionLink>
            </>
          )}

          {state.kind === "accept" && (
            <>
              <p className="type-body-sm text-muted-foreground">{t("recruiterInvite.acceptLead")}</p>
              <form action={acceptInviteAction} className="grid">
                <input type="hidden" name="token" value={token ?? ""} />
                <Button type="submit" size="lg" data-testid="invite-accept">
                  {t("recruiterInvite.accept")}
                </Button>
              </form>
            </>
          )}

          {state.kind === "other_email" && (
            <p className="type-body-md min-w-0 break-words" role="status" data-testid="invite-other-email-message">
              {t("recruiterInvite.otherEmail")} <strong data-user-content>{state.maskedEmail}</strong>.{" "}
              {t("recruiterInvite.signOutToContinue")}
            </p>
          )}

          {state.kind === "needs_recruiter" && (
            <p className="type-body-md" role="status" data-testid="invite-needs-recruiter-message">
              {t("recruiterInvite.needsRecruiter")}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
