import { TransitionLink } from "../transition-link";
import { Card } from "@/components/ui/card";
import { recruiterCandidateSummaries } from "../../src/contexts/pursuit/index.ts";
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
  const { t, locale } = await getTranslator();
  const session = await requirePage("job:read");
  const summaries = await recruiterCandidateSummaries(session.linkedCandidateIds);

  return (
    <main className="pt-10" data-testid="route-recruiter">
      <h1 className="type-display-md chevron mb-4">{t("recruiter.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("recruiter.lead")}
      </p>

      {summaries.length === 0 ? (
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
                <span data-user-content>{summary.name}</span>
              </TransitionLink>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t("recruiter.applications", { count: String(summary.total) })}</span>
                {applicationStatusOptions(t, locale)
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
