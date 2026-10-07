import { TransitionLink } from "../transition-link";
import { Card } from "@/components/ui/card";
import { recruiterCandidateSummaries } from "../../src/contexts/pursuit/index.ts";
import { showsRecruiterEmptyState } from "../../src/contexts/auth/index.ts";
import { applicationStatusOptions } from "../status.ts";
import { requirePage } from "../auth";
import { getTranslator } from "../i18n";

export const dynamic = "force-dynamic";

/**
 * O que o recrutador acompanha — e nada além disso.
 *
 * O escopo vem da SESSÃO (`linkedCandidateIds`), resolvido na carga dela, e
 * segue para o SQL como lista. A página nunca aceita um id de candidato vindo
 * da URL para montar esta lista: id em parâmetro é pedido, não prova.
 */
export default async function RecruiterHistory() {
  const { t } = await getTranslator();
  const session = await requirePage("job:read");
  const summaries = await recruiterCandidateSummaries(session.linkedCandidateIds);

  return (
    <main className="pt-10" data-testid="route-recruiter">
      <h1 className="type-display-md chevron mb-4">{t("recruiter.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("recruiter.lead")}
      </p>

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
      ) : summaries.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="recruiter-empty">
          {t("recruiter.noCandidates")}
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {summaries.map((summary) => (
            <div key={summary.candidateId} className="bg-card px-4 py-3.5 sm:px-5">
              <TransitionLink
                href={`/recruiter/${summary.candidateId}`}
                data-testid={`recruiter-candidate-${summary.candidateId}`}
                className="font-semibold hover:underline"
              >
                {/* Candidato sem nome escolhido: o link não pode ficar vazio. */}
                {summary.name.trim() !== "" ? (
                  <span data-user-content>{summary.name}</span>
                ) : (
                  <span>{t("publicName.unnamed")}</span>
                )}
              </TransitionLink>
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
    </main>
  );
}
