import type { Route } from "next";
import { TransitionLink } from "../transition-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STATUSES,
  PIPELINE_PAGE_SIZE,
  pipelineCounts,
  pipelineRows,
  type ApplicationStatus,
} from "../../src/contexts/pursuit/index.ts";
import { jobLifecycleState } from "../../src/core/ingest/lifecycle.ts";
import { isPublicJobUrl } from "../../src/core/job-url.ts";
import { ACTION_BUTTON, Fit, StatusBadge } from "../ui";
import { applicationStatusOptions } from "../status.ts";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";

export const dynamic = "force-dynamic";

/** Estágio da URL: desconhecido não quebra a página, mostra o funil inteiro. */
function readStage(value: string | undefined): {
  stage: ApplicationStatus | null;
  invalid: boolean;
} {
  if (!value) return { stage: null, invalid: false };
  const stage = FUNNEL_STATUSES.find((status) => status === value);
  return stage ? { stage, invalid: false } : { stage: null, invalid: true };
}

export default async function Pipeline({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getTranslator();
  const { candidateId } = await requireOwnCandidatePage("candidate:read");

  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const { stage, invalid } = readStage(one("stage"));
  const asked = Math.max(1, Number(one("page") ?? 1) || 1);

  // As contagens vêm antes das linhas porque é delas que sai a última página.
  // Pedir uma página além do fim devolvia zero linhas, e a tela dizia "nada no
  // funil ainda" para quem TEM candidatura — a mesma mentira que a lista vazia
  // contaria num estágio desconhecido.
  const counts = await pipelineCounts(candidateId);
  // O total vem das contagens, não da página: paginar não muda quantas
  // candidaturas existem, e recontar por página faria o número piscar.
  const everything = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const total = stage ? (counts[stage] ?? 0) : everything;
  const lastPage = Math.max(1, Math.ceil(total / PIPELINE_PAGE_SIZE));
  const page = Math.min(asked, lastPage);

  const rows = await pipelineRows(candidateId, {
    status: stage,
    limit: PIPELINE_PAGE_SIZE,
    offset: (page - 1) * PIPELINE_PAGE_SIZE,
  });
  const href = (next: { stage?: string | null; page?: number }): Route => {
    const query = new URLSearchParams();
    const wanted = next.stage === undefined ? stage : next.stage;
    if (wanted) query.set("stage", wanted);
    const wantedPage = next.page ?? 1;
    if (wantedPage > 1) query.set("page", String(wantedPage));
    const search = query.toString();
    // Mesma saída das demais telas com filtro na URL: o Next tipa rota, e um
    // `string` montado em tempo de execução não passa por esse tipo.
    return (search ? `/pipeline?${search}` : "/pipeline") as Route;
  };

  return (
    <main className="pt-10" data-testid="route-pipeline">
      <h1 className="type-display-md chevron mb-4">{t("pipeline.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.pipelineLead")}
      </p>

      {invalid && (
        <Card className="mb-4 p-4 text-sm text-muted-foreground" data-testid="pipeline-unknown-stage">
          {t("pipeline.unknownStage")}
        </Card>
      )}

      <div className="mb-8 flex flex-wrap gap-2.5">
        <TransitionLink href={href({ stage: null })} data-testid="pipeline-filter-all">
          <Card
            className={cn(
              "min-w-[96px] gap-0 px-4 py-2.5",
              stage === null && "border-[var(--primary)]",
            )}
          >
            <div className="font-mono text-2xl font-bold tabular-nums">{everything}</div>
            <div className="mt-0.5 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
              {t("pipeline.allStages")}
            </div>
          </Card>
        </TransitionLink>
        {applicationStatusOptions(t)
          .filter(({ value }) => counts[value])
          .map(({ value, label }) => (
            <TransitionLink
              key={value}
              href={href({ stage: value })}
              data-testid={`pipeline-filter-${value}`}
            >
              <Card
                className={cn(
                  "min-w-[96px] gap-0 px-4 py-2.5",
                  stage === value && "border-[var(--primary)]",
                )}
              >
                <div className="font-mono text-2xl font-bold tabular-nums">{counts[value]}</div>
                <div className="mt-0.5 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
                  {label}
                </div>
              </Card>
            </TransitionLink>
          ))}
      </div>

      {rows.length === 0 && stage ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="pipeline-empty-stage">
          {t("pipeline.noneInStage")}{" "}
          <TransitionLink
            href={href({ stage: null })}
            data-testid="pipeline-empty-stage-all"
            className="text-[var(--primary-text)] hover:underline"
          >
            {t("pipeline.allStages")}
          </TransitionLink>
          .
        </Card>
      ) : rows.length === 0 ? (
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
                  {jobLifecycleState({ closedAt: r.jobClosedAt, archivedAt: r.jobArchivedAt }) !==
                    "active" && (
                    // Estado da VAGA, ao lado do estágio da candidatura e nunca
                    // no lugar dele: a vaga encerrar não move ninguém no funil.
                    <Badge
                      variant="outline"
                      className="font-mono type-micro text-muted-foreground"
                      data-testid={`pipeline-job-state-${r.jobId}`}
                    >
                      {t(r.jobArchivedAt ? "pipeline.jobArchived" : "pipeline.jobClosed")}
                    </Badge>
                  )}
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

      {lastPage > 1 && (
        <nav
          className="mt-6 flex flex-wrap items-center gap-3 text-sm"
          data-testid="pipeline-pagination"
        >
          {page > 1 ? (
            <TransitionLink
              href={href({ page: page - 1 })}
              data-testid="pipeline-previous"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), ACTION_BUTTON)}
            >
              ← {t("grid.previous")}
            </TransitionLink>
          ) : null}
          <span className="text-muted-foreground">
            {t("grid.page")} {page} {t("grid.of")} {lastPage}
          </span>
          {page < lastPage ? (
            <TransitionLink
              href={href({ page: page + 1 })}
              data-testid="pipeline-next"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), ACTION_BUTTON)}
            >
              {t("grid.next")} →
            </TransitionLink>
          ) : null}
        </nav>
      )}
    </main>
  );
}
