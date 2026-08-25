import { TransitionLink } from "../transition-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { pipelineCounts, pipelineRows } from "../../src/contexts/pursuit/index.ts";
import { isPublicJobUrl } from "../../src/core/job-url.ts";
import { ACTION_BUTTON, Fit, StatusBadge } from "../ui";
import { applicationStatusOptions } from "../status.ts";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const { t, locale } = await getTranslator();
  const { candidateId } = await requireOwnCandidatePage("candidate:read");

  const [counts, rows] = await Promise.all([
    pipelineCounts(candidateId),
    pipelineRows(candidateId),
  ]);

  return (
    <main className="pt-10" data-testid="route-pipeline">
      <h1 className="type-display-md chevron mb-4">{t("pipeline.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.pipelineLead")}
      </p>

      <div className="mb-8 flex flex-wrap gap-2.5">
        {applicationStatusOptions(t, locale)
          .filter(({ value }) => counts[value])
          .map(({ value, label }) => (
            <Card key={value} className="min-w-[96px] gap-0 px-4 py-2.5">
              <div className="font-mono text-2xl font-bold tabular-nums">{counts[value]}</div>
              <div className="mt-0.5 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
                {label}
              </div>
            </Card>
          ))}
      </div>

      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {t("pipeline.noApplications")} {t("pipeline.startWith")}{" "}
          <TransitionLink href="/jobs" data-testid="pipeline-empty-jobs" className="text-[var(--primary-text)] hover:underline">
            {t("pipeline.jobsList")}
          </TransitionLink>
          .
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {rows.map((r) => (
            <div
              key={r.jobId}
              className="grid grid-cols-[44px_1fr] items-center gap-3 bg-card px-4 py-3.5 sm:grid-cols-[52px_1fr_auto] sm:gap-4 sm:px-5"
            >
              <div className="text-center">
                <Fit value={r.fit} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <TransitionLink href={`/jobs/${r.jobId}`} data-testid={`pipeline-job-${r.jobId}`} className="font-semibold hover:underline">
                    {r.title}
                  </TransitionLink>
                  <StatusBadge status={r.status} t={t} />
                  {r.channel && (
                    <Badge variant="outline" className="font-mono type-micro">
                      {r.channel}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.companyName}
                  {r.appliedAt ? ` · ${t("pipeline.appliedOn", { date: r.appliedAt.slice(0, 10) })}` : ""}
                </div>
                {r.nextAction && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("pipeline.nextAction", { action: r.nextAction })}
                  </div>
                )}
              </div>
              {isPublicJobUrl(r.url) ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    ACTION_BUTTON,
                    // Own row on a phone; right-hand column from `sm` up.
                    "col-span-2 justify-self-start sm:col-span-1 sm:justify-self-auto",
                  )}
                >
                  {t("pipeline.open")} →
                </a>
              ) : (
                <TransitionLink
                  href={`/jobs/${r.jobId}`}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    ACTION_BUTTON,
                    "col-span-2 justify-self-start sm:col-span-1 sm:justify-self-auto",
                  )}
                >
                  {t("pipeline.open")} →
                </TransitionLink>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
