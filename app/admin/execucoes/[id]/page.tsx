import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isRetryable, sourceRun, sourceRunChildren, type RunStatus } from "../../../../src/contexts/operations/index.ts";
import { requirePage } from "../../../auth";
import { getTranslator } from "../../../i18n";
import { MutationFeedbackForm } from "../../../mutation-feedback";
import { TransitionLink } from "../../../transition-link";
import { retryRunAction } from "../actions";
import { RunCounts, RunStatusBadge, reasonLabel, scopeLabel } from "../run-view";

export const dynamic = "force-dynamic";

/**
 * Uma execução: escopo, estado, contagens (desconhecido nunca vira zero),
 * completude, motivo e, na execução "todas", uma linha por fonte. Sobrevive a
 * refresh porque tudo vem da linha de `source_run`.
 */
export default async function AdminRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getTranslator();
  await requirePage("admin:access");
  const runId = Number((await params).id);
  if (!Number.isSafeInteger(runId) || runId <= 0) notFound();
  const run = await sourceRun(runId);
  if (!run) notFound();
  const children = run.scopeKind === "all" ? await sourceRunChildren(run.id) : [];
  const stamp = (value: string | null) => (value ? new Date(value).toLocaleString(locale) : "—");
  const reason = reasonLabel(run, t);

  return (
    <main className="page-content-top" data-testid="route-admin-run">
      <TransitionLink href="/admin/execucoes" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
        {t("runs.back")}
      </TransitionLink>
      <header className="mt-2 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="type-display-md">#{run.id} · {scopeLabel(run, t)}</h1>
          <RunStatusBadge run={run} t={t} />
        </div>
        {run.sourceId && (
          <p className="mt-2 font-mono type-meta break-all text-muted-foreground" data-user-content>
            {run.sourceId}
          </p>
        )}
      </header>

      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-6">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <dt className="type-caption-sm text-muted-foreground">{t("runs.queuedAt")}</dt>
              <dd className="type-body-md">{stamp(run.queuedAt)}</dd>
            </div>
            <div>
              <dt className="type-caption-sm text-muted-foreground">{t("runs.finishedAt")}</dt>
              <dd className="type-body-md">{stamp(run.finishedAt)}</dd>
            </div>
            <div>
              <dt className="type-caption-sm text-muted-foreground">{t("runs.actor")}</dt>
              <dd className="type-body-md">{run.actorUserId === null ? t("runs.actorScheduler") : t("runs.actorAdmin")}</dd>
            </div>
            <div>
              <dt className="type-caption-sm text-muted-foreground">{t("runs.completeness")}</dt>
              <dd className="type-body-md" data-testid="run-completeness">
                {t(
                  run.completeness === "complete"
                    ? "platforms.snapshotComplete"
                    : run.completeness === "partial"
                      ? "platforms.snapshotPartial"
                      : "platforms.snapshotUnknown",
                )}
              </dd>
            </div>
          </dl>
          {run.retryOf !== null && (
            <p className="type-caption-md text-muted-foreground">
              {t("runs.retryOf")}{" "}
              <TransitionLink href={`/admin/execucoes/${run.retryOf}`} className="text-[var(--primary-text)] hover:underline">
                #{run.retryOf}
              </TransitionLink>
            </p>
          )}
          {reason && (
            <p className="type-body-md" role="status" data-testid="run-reason">
              {reason}
            </p>
          )}
          {run.errorDetail && (
            <p className="type-caption-md wrap-anywhere text-muted-foreground" data-user-content data-testid="run-error-detail">
              {run.errorDetail}
            </p>
          )}
          <RunCounts run={run} t={t} />
          {isRetryable(run.status as RunStatus) && (
            <MutationFeedbackForm
              action={retryRunAction}
              successMessage={t("runs.retried")}
              errorMessage={t("feedback.error")}
              dismissLabel={t("feedback.dismiss")}
              resultMessages={{
                not_retryable: t("runs.notRetryable"),
                run_not_found: t("runs.notFound"),
                source_disabled: t("platforms.errorDisabled"),
                source_retired: t("platforms.errorRetired"),
                source_not_found: t("platforms.errorNotFound"),
              }}
              data-testid="run-retry-form"
            >
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" variant="outline" className="h-auto min-h-11 w-full sm:w-auto" data-testid="run-retry">
                {t("runs.retry")}
              </Button>
            </MutationFeedbackForm>
          )}
        </CardContent>
      </Card>

      {children.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="type-display-xs">{t("runs.children")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--hairline)]" data-testid="run-children">
              {children.map((child) => {
                const childReason = reasonLabel(child, t);
                return (
                  <li key={child.id} className="grid gap-2 py-3" data-testid={`run-child-${child.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <TransitionLink href={`/admin/execucoes/${child.id}`} className="font-mono text-[var(--primary-text)] hover:underline break-all" data-user-content>
                        {child.sourceId}
                      </TransitionLink>
                      <RunStatusBadge run={child} t={t} />
                    </div>
                    {childReason && <p className="type-caption-md text-muted-foreground">{childReason}</p>}
                    <RunCounts run={child} t={t} />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
