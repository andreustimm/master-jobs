import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { sourceRuns } from "../../../src/contexts/operations/index.ts";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { MutationFeedbackForm } from "../../mutation-feedback";
import { TransitionLink } from "../../transition-link";
import { requestAllRunsAction } from "./actions";
import { RunCounts, RunStatusBadge, reasonLabel, scopeLabel } from "./run-view";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * Histórico de execuções de captura e verificação (#223, tarefa 03).
 *
 * Só execuções de topo, paginadas; as filhas de "todas" aparecem no detalhe.
 * A captura por termo continua em `term_capture` e só aparece como agregado,
 * na tela de capturas — nenhum termo nem candidato passa por aqui (A3).
 */
export default async function AdminRunsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { t, locale } = await getTranslator();
  await requirePage("admin:access");
  const requested = Number((await searchParams).page ?? "1");
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const { rows, total } = await sourceRuns({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stamp = (value: string | null) => (value ? new Date(value).toLocaleString(locale) : "—");
  const feedback = {
    successMessage: t("runs.requested"),
    errorMessage: t("feedback.error"),
    dismissLabel: t("feedback.dismiss"),
    resultMessages: { source_disabled: t("platforms.errorDisabled") },
  };

  return (
    <main className="page-content-top" data-testid="route-admin-runs">
      <header className="pb-4">
        <TransitionLink href="/admin/operacoes" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("operations.title")}
        </TransitionLink>
        <h1 className="type-display-md chevron mt-2 mb-4">{t("runs.title")}</h1>
        <p className="type-body-md max-w-[62ch] text-muted-foreground">{t("runs.lead")}</p>
      </header>

      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-6 sm:flex sm:flex-wrap">
          <MutationFeedbackForm action={requestAllRunsAction} {...feedback} data-testid="runs-capture-all-form">
            <input type="hidden" name="scope" value="all" />
            <Button type="submit" className="h-auto min-h-11 w-full sm:w-auto" data-testid="runs-capture-all">
              {t("runs.captureAll")}
            </Button>
          </MutationFeedbackForm>
          <MutationFeedbackForm action={requestAllRunsAction} {...feedback} data-testid="runs-verify-all-form">
            <input type="hidden" name="scope" value="verify" />
            <Button type="submit" variant="outline" className="h-auto min-h-11 w-full sm:w-auto" data-testid="runs-verify-all">
              {t("runs.verifyAll")}
            </Button>
          </MutationFeedbackForm>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="type-body-md text-muted-foreground" data-testid="runs-empty">{t("runs.empty")}</p>
      ) : (
        <ul className="grid gap-3" data-testid="runs-list">
          {rows.map((run) => {
            const reason = reasonLabel(run, t);
            return (
              <li key={run.id}>
                <Card>
                  <CardContent className="grid gap-2 pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <TransitionLink
                        href={`/admin/execucoes/${run.id}`}
                        className="type-body-emphasis text-[var(--primary-text)] hover:underline"
                        data-testid={`run-link-${run.id}`}
                      >
                        #{run.id} · {scopeLabel(run, t)}
                      </TransitionLink>
                      <RunStatusBadge run={run} t={t} />
                      {run.sourceId && (
                        <span className="type-caption-md min-w-0 break-all font-mono text-muted-foreground" data-user-content>
                          {run.sourceId}
                        </span>
                      )}
                    </div>
                    <p className="type-caption-md text-muted-foreground">
                      {t("runs.queuedAt")}: {stamp(run.queuedAt)}
                    </p>
                    {reason && <p className="type-caption-md text-muted-foreground">{reason}</p>}
                    <RunCounts run={run} t={t} />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="mt-4 flex flex-wrap items-center gap-3" aria-label={t("runs.page", { page, pages })}>
        {page > 1 && (
          <TransitionLink href={`/admin/execucoes?page=${page - 1}`} className="text-[var(--primary-text)] hover:underline" data-testid="runs-previous">
            {t("runs.previous")}
          </TransitionLink>
        )}
        <span className="type-caption-md text-muted-foreground" data-testid="runs-page">{t("runs.page", { page, pages })}</span>
        {page < pages && (
          <TransitionLink href={`/admin/execucoes?page=${page + 1}`} className="text-[var(--primary-text)] hover:underline" data-testid="runs-next">
            {t("runs.next")}
          </TransitionLink>
        )}
      </nav>

      <p className="mt-6 type-caption-md text-muted-foreground">
        {t("runs.termCaptures")}{" "}
        <TransitionLink href="/admin/captures" className="text-[var(--primary-text)] hover:underline">
          {t("runs.termCapturesLink")}
        </TransitionLink>
      </p>
    </main>
  );
}
