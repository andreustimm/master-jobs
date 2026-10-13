import type { Route } from "next";
import { TransitionLink } from "../transition-link";
import { Card } from "@/components/ui/card";
import { recruiterCandidateList } from "../../src/contexts/pursuit/index.ts";
import { inviteNoticeOf, showsRecruiterEmptyState, type ArrivalNotice } from "../../src/contexts/auth/index.ts";
import type { TranslationKey } from "../../src/core/i18n/index.ts";
import { applicationStatusOptions } from "../status.ts";
import { requirePage } from "../auth";
import { getTranslator } from "../i18n";
import { CandidateName, DatedText, Pager } from "./recruiter-ui";

export const dynamic = "force-dynamic";

/** O aviso de chegada pelo convite (#465, ADR-018), por desfecho. Nenhum cita o candidato. */
const INVITE_NOTICE: Record<ArrivalNotice, TranslationKey> = {
  mismatch: "recruiterInvite.noticeMismatch",
  not_recruiter: "recruiterInvite.noticeNotRecruiter",
  period_over: "recruiterInvite.noticePeriodOver",
  invalid: "recruiterInvite.noticeInvalid",
};

/**
 * O que o recrutador acompanha — e nada além disso.
 *
 * O escopo vem da SESSÃO (`linkedCandidateIds`), resolvido na carga dela, e
 * segue para o SQL como lista. A página nunca aceita um id de candidato vindo
 * da URL para montar esta lista: id em parâmetro é pedido, não prova.
 *
 * Cada candidato aparece com desde quando o recrutador tem acesso, o fim se
 * houver e quantas sugestões dele esperam a decisão da pessoa (US-013.AC-1),
 * 25 por página, por nome (US-005.EC-4).
 */
export default async function RecruiterHistory({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; invite?: string | string[] }>;
}) {
  const { t, locale } = await getTranslator();
  const session = await requirePage("job:read");
  const query = await searchParams;
  const list = await recruiterCandidateList(session, query.page);
  const notice = inviteNoticeOf(query.invite);

  return (
    <main className="pt-10" data-testid="route-recruiter">
      <h1 className="type-display-md chevron mb-4">{t("recruiter.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("recruiter.lead")}
      </p>

      {notice !== null && (
        // Chegada pelo convite que não virou acesso: o porquê, sem nada do
        // candidato (US-004.AC-2). Valor da URL fora da lista não mostra nada.
        <Card className="mb-6 p-4" role="status" data-testid="recruiter-invite-notice" data-notice={notice}>
          <p className="type-body-md">{t(INVITE_NOTICE[notice])}</p>
        </Card>
      )}

      {showsRecruiterEmptyState(session) ? (
        // Recrutador sem ninguém que lhe tenha dado acesso (US-015): explica
        // de onde o acesso vem, em vez de uma lista vazia sem motivo. Com um
        // vínculo, a lista de sempre volta (US-015.EC-1).
        <Card className="grid gap-3 p-6" data-testid="recruiter-empty">
          <h2 className="type-display-xs" data-testid="recruiter-empty-state">
            {t("recruiter.emptyTitle")}
          </h2>
          <p className="type-body-md max-w-[62ch] text-muted-foreground">{t("recruiter.emptyBody")}</p>
          <p className="type-body-sm text-muted-foreground">
            {t("recruiter.emptyJobs")}{" "}
            <TransitionLink href="/jobs" className="text-[var(--primary-text)] underline" data-testid="recruiter-empty-jobs">
              {t("recruiter.emptyJobsLink")}
            </TransitionLink>
          </p>
        </Card>
      ) : list.rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="recruiter-empty">
          {t("recruiter.noCandidates")}
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {list.rows.map((summary) => (
            <div key={summary.candidateId} className="bg-card px-4 py-3.5 sm:px-5" data-testid="recruiter-row">
              <TransitionLink
                href={`/recruiter/${summary.candidateId}`}
                data-testid={`recruiter-candidate-${summary.candidateId}`}
                className="inline-flex min-h-11 items-center font-semibold break-words hover:underline sm:min-h-0"
              >
                <CandidateName name={summary.name} headline={summary.headline} t={t} />
              </TransitionLink>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <DatedText t={t} keyName="recruiter.since" iso={summary.since} locale={locale} testId="recruiter-row-since" />
                {summary.until !== null && (
                  <span data-testid="recruiter-row-until">
                    {t("recruiterAccess.endsAt", {
                      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: summary.untilTz ?? "UTC" }).format(
                        new Date(summary.until),
                      ),
                      tz: summary.untilTz ?? "UTC",
                    })}
                  </span>
                )}
                {summary.pending > 0 && (
                  <span data-testid="recruiter-row-pending">
                    {t("recruiter.pending", { count: String(summary.pending) })}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t("recruiter.applications", { count: String(summary.total) })}</span>
                {applicationStatusOptions(t)
                  .filter(({ value }) => summary.counts[value])
                  .map(({ value, label }) => (
                    <span key={value} className="font-mono type-micro">
                      {summary.counts[value]} {label}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pager
        page={list.page}
        pages={list.pages}
        href={(page) => (page > 1 ? `/recruiter?page=${page}` : "/recruiter") as Route}
        testId="recruiter-list-pagination"
        t={t}
      />
    </main>
  );
}
