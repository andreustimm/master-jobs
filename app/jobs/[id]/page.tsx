import { TransitionLink } from "../../transition-link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getJobDetail } from "../../../src/contexts/pursuit/index.ts";
import { scoreMessages } from "../../../src/contexts/matching/index.ts";
import { renderScoreMessage } from "../../../src/core/i18n/index.ts";
import { isPublicJobUrl } from "../../../src/core/job-url.ts";
import { trackAction } from "../../actions";
import { Fit, Legend, ScoreBar, StatusBadge } from "../../ui";
import { requireOwnCandidatePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { applicationStatusOptions } from "../../status.ts";
import { MutationFeedbackForm } from "../../mutation-feedback";

export const dynamic = "force-dynamic";

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getTranslator();
  const { candidateId } = await requireOwnCandidatePage("candidate:read");

  const { id } = await params;
  const detail = await getJobDetail(candidateId, Number(id));
  if (!detail) notFound();

  const { job, score, application, source } = detail;
  const blockers = scoreMessages(score?.blockers);
  const matched = (score?.matchedKeywords as string[]) ?? [];
  const missing = (score?.missingKeywords as string[]) ?? [];
  const reasons = scoreMessages(score?.reasons);
  const externalUrl = isPublicJobUrl(job.url);
  const externalApplyUrl = isPublicJobUrl(job.applyUrl) ? job.applyUrl : null;

  return (
    <main className="pt-9 pb-16" data-testid="route-job-detail">
      <TransitionLink href="/jobs" data-testid="job-detail-back" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
        ← vagas
      </TransitionLink>

      <header className="mt-4 mb-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="type-display-md text-balance">{job.title}</h1>
          {application && <StatusBadge status={application.status} t={t} />}
          {job.closedAt && <Badge variant="destructive">fechada</Badge>}
          {!externalUrl && <Badge variant="secondary">{t("compare.manualJob")}</Badge>}
        </div>
        <p className="mt-2 text-muted-foreground">
          <strong className="text-foreground">{job.companyName}</strong>
          {job.locationRaw ? ` · ${job.locationRaw}` : ""}
        </p>
        <p className="mt-1.5 font-mono type-meta text-muted-foreground">
          {source?.label ?? job.sourceId} · visto em {job.firstSeenAt.slice(0, 10)}
        </p>

        {/* Two destinations: the bare URL shows the description, /apply opens
            the form. Sending someone to a form for a job they have not read is
            the wrong default. */}
        {externalUrl && (
          <>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <a
                href={job.url}
                target="_blank"
                rel="noopener"
                className={buttonVariants({ variant: "outline" })}
              >
                Ver vaga na origem
              </a>
              {externalApplyUrl && externalApplyUrl !== job.url && (
                <a href={externalApplyUrl} target="_blank" rel="noopener" className={buttonVariants()}>
                  Aplicar →
                </a>
              )}
            </div>
            <p className="mt-2 font-mono type-meta break-all text-muted-foreground">{job.url}</p>
          </>
        )}
      </header>

      {score && (
        <Card className="mb-6">
          <CardContent className="pt-0">
            <div className="mb-3 flex items-center gap-3.5">
              <Fit value={score.fit} />
              <span className="text-sm text-muted-foreground">
                de 100 · cluster <span className="font-mono">{score.cluster}</span>
              </span>
            </div>

            <ScoreBar parts={score} t={t} />
            <div className="mt-3">
              <Legend t={t} />
            </div>

            <ul className="mt-4 list-disc pl-5 type-caption-sm text-muted-foreground">
              {reasons.map((r, i) => (
                <li key={i} className="mb-0.5">
                  {renderScoreMessage(r, t)}
                </li>
              ))}
            </ul>

            {blockers.length > 0 && (
              <p className="mt-3.5 type-caption-sm text-destructive">
                ⚠ {blockers.map((blocker) => renderScoreMessage(blocker, t)).join("; ")}
              </p>
            )}

            {matched.length > 0 && (
              <>
                <Separator className="my-4" />
                <p className="font-mono type-meta text-muted-foreground">
                  casadas: {matched.join(", ")}
                </p>
              </>
            )}
            {missing.length > 0 && (
              <p className="mt-1.5 font-mono type-meta text-muted-foreground">
                ausentes: {missing.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <MutationFeedbackForm
        action={trackAction}
        successMessage={t("feedback.success")}
        errorMessage={t("feedback.error")}
        dismissLabel={t("feedback.dismiss")}
        className="mb-7 flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="jobId" value={job.id} />
        <span className="font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
          mover para
        </span>
        <select
          name="status"
          defaultValue={application?.status ?? "shortlisted"}
          className={cn(
            "h-9 rounded-lg border border-input bg-background px-3 text-sm",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          )}
        >
          {applicationStatusOptions(t, locale).map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Input name="note" placeholder="nota (opcional)" className="max-w-[260px]" />
        <Button type="submit">Salvar</Button>
      </MutationFeedbackForm>

      {job.descriptionText && (
        <section>
          <h2 className="type-display-xs mb-3">{t("jobDetail.description")}</h2>
          <Card>
            <CardContent className="max-h-[520px] overflow-auto pt-0">
              <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {job.descriptionText}
              </pre>
            </CardContent>
          </Card>
        </section>
      )}
    </main>
  );
}
