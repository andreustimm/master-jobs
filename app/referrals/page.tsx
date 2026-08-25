import { TransitionLink } from "../transition-link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { companiesWithContacts, referralOpportunities } from "../../src/core/contacts.ts";
import { publicApplyUrl } from "../../src/core/job-url.ts";
import { ACTION_BUTTON, Fit, StatusBadge } from "../ui";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";

export const dynamic = "force-dynamic";

export default async function Referrals() {
  const { t, locale } = await getTranslator();
  void locale;
  const { candidateId } = await requireOwnCandidatePage("candidate:read");

  const [opps, network] = await Promise.all([
    referralOpportunities(candidateId, 40),
    companiesWithContacts(),
  ]);

  return (
    <main className="pt-10" data-testid="route-referrals">
      <h1 className="type-display-md chevron mb-4">Referrals</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.referralsLead")}</p>

      {opps.length === 0 ? (
        <Card className="p-6 text-muted-foreground">
          {network.size === 0 ? (
            <>
              Nenhum contato registrado. Comece com{" "}
              <code className="font-mono text-foreground">pnpm jho contacts seed</code>, que
              {t("copy.referralsSeed")}
            </>
          ) : (
            <>
              <strong className="text-foreground">{network.size} {t("referrals.companies")}</strong>{" "}
              {t("copy.referralsEmpty")}
            </>
          )}
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {opps.map((o) => {
            const externalUrl = publicApplyUrl(o);
            const actionClass = cn(
              buttonVariants({ size: "sm" }),
              ACTION_BUTTON,
              // Own row on a phone; right-hand column from `sm` up.
              "col-span-2 justify-self-start sm:col-span-1 sm:justify-self-auto",
            );
            return (
              <div
              key={o.jobId}
              className="grid grid-cols-[44px_1fr] items-center gap-3 bg-card px-4 py-3.5 sm:grid-cols-[52px_1fr_auto] sm:gap-4 sm:px-5"
            >
              <div className="text-center">
                <Fit value={o.fit} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <TransitionLink href={`/jobs/${o.jobId}`} data-testid={`referral-job-${o.jobId}`} className="font-semibold hover:underline">
                    {o.title}
                  </TransitionLink>
                  {o.status && <StatusBadge status={o.status} />}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{o.companyName}</div>
                <div className="mt-1 text-xs text-[var(--color-strong)]">
                  via {o.contacts.join(", ")}
                </div>
              </div>
                {externalUrl ? (
                  <a href={externalUrl} target="_blank" rel="noopener" className={actionClass}>
                    {t("jobs.apply")} →
                  </a>
                ) : (
                  <TransitionLink href={`/jobs/${o.jobId}`} className={actionClass}>
                    {t("jobs.view")} →
                  </TransitionLink>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
