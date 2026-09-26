import type { Route } from "next";
import { notFound } from "next/navigation";
import { TransitionLink } from "../../transition-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  PIPELINE_PAGE_SIZE,
  pipelineCounts,
  pipelineRows,
} from "../../../src/contexts/pursuit/index.ts";
import { jobLifecycleState } from "../../../src/core/ingest/lifecycle.ts";
import { StatusBadge } from "../../ui";
import { applicationStatusOptions } from "../../status.ts";
import { requirePage, requireSession } from "../../auth";
import { getTranslator } from "../../i18n";

export const dynamic = "force-dynamic";

/**
 * O histórico de UM candidato que o recrutador acompanha.
 *
 * O id vem da URL, e por isso ele é conferido contra o vínculo da SESSÃO antes
 * de qualquer leitura. Candidato inexistente e candidato que existe mas não é
 * acompanhado recebem a MESMA resposta — 404 —, porque distinguir os dois
 * contaria que aquela pessoa está cadastrada, e existência é informação.
 * É o mesmo raciocínio de `/p/[slug]`.
 */
export default async function RecruiterCandidateHistory({
  params,
  searchParams,
}: {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getTranslator();
  const session = await requireSession();
  const { candidateId: raw } = await params;

  const candidateId = Number(raw);
  // Id malformado cai no mesmo 404: `Number("../etc")` é `NaN`, e um `NaN`
  // chegando à query seria uma pergunta que o banco não deveria receber.
  if (!Number.isInteger(candidateId) || !session.linkedCandidateIds.includes(candidateId)) {
    notFound();
  }
  // O vínculo decide o 404; a POLÍTICA decide a leitura. Sem esta chamada a
  // tela autorizava por conta própria, fora de `can()` — e uma regra nova da
  // política (sessão emprestada, papel retirado) não chegaria aqui. Regra 15.
  await requirePage("candidate:read", { kind: "candidate", candidateId });

  const query = await searchParams;
  const rawPage = query.page;
  const page = Math.max(1, Number((Array.isArray(rawPage) ? rawPage[0] : rawPage) ?? 1) || 1);

  const [counts, rows] = await Promise.all([
    pipelineCounts(candidateId),
    pipelineRows(candidateId, {
      limit: PIPELINE_PAGE_SIZE,
      offset: (page - 1) * PIPELINE_PAGE_SIZE,
    }),
  ]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const lastPage = Math.max(1, Math.ceil(total / PIPELINE_PAGE_SIZE));
  const pageHref = (wanted: number): Route =>
    (wanted > 1
      ? `/recruiter/${candidateId}?page=${wanted}`
      : `/recruiter/${candidateId}`) as Route;

  return (
    <main className="pt-10" data-testid="route-recruiter-candidate">
      <TransitionLink
        href="/recruiter"
        data-testid="recruiter-back"
        className="type-body-sm text-[var(--primary-text)] hover:underline"
      >
        ← {t("recruiter.title")}
      </TransitionLink>
      <h1 className="type-display-md chevron mt-2 mb-4" data-user-content>
        {t("recruiter.candidateHistory", { count: String(total) })}
      </h1>

      <div className="mb-8 flex flex-wrap gap-2.5">
        {applicationStatusOptions(t)
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
        <Card className="p-6 text-sm text-muted-foreground" data-testid="recruiter-candidate-empty">
          {t("recruiter.noApplications")}
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {rows.map((row) => (
            <div key={row.jobId} className="bg-card px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <TransitionLink
                  href={`/jobs/${row.jobId}`}
                  data-testid={`recruiter-job-${row.jobId}`}
                  className="font-semibold hover:underline"
                >
                  {row.title}
                </TransitionLink>
                <StatusBadge status={row.status} t={t} />
                {jobLifecycleState({
                  closedAt: row.jobClosedAt,
                  archivedAt: row.jobArchivedAt,
                }) !== "active" && (
                  <Badge
                    variant="outline"
                    className="font-mono type-micro text-muted-foreground"
                    data-testid={`recruiter-job-state-${row.jobId}`}
                  >
                    {t(row.jobArchivedAt ? "pipeline.jobArchived" : "pipeline.jobClosed")}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {row.companyName}
                {row.appliedAt
                  ? ` · ${t("pipeline.appliedOn", { date: row.appliedAt.slice(0, 10) })}`
                  : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {lastPage > 1 && (
        <nav
          className="mt-6 flex flex-wrap items-center gap-3 text-sm"
          data-testid="recruiter-pagination"
        >
          {page > 1 ? (
            <TransitionLink
              href={pageHref(page - 1)}
              data-testid="recruiter-previous"
              className="text-[var(--primary-text)] hover:underline"
            >
              ← {t("grid.previous")}
            </TransitionLink>
          ) : null}
          <span className="text-muted-foreground">
            {t("grid.page")} {page} {t("grid.of")} {lastPage}
          </span>
          {page < lastPage ? (
            <TransitionLink
              href={pageHref(page + 1)}
              data-testid="recruiter-next"
              className="text-[var(--primary-text)] hover:underline"
            >
              {t("grid.next")} →
            </TransitionLink>
          ) : null}
        </nav>
      )}
    </main>
  );
}
