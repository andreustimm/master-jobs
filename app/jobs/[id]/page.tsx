import { TransitionLink } from "../../transition-link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  allowedTransitions,
  applicationTimeline,
  getJobDetail,
} from "../../../src/contexts/pursuit/index.ts";
import { listCandidateTracks, scoreMessages } from "../../../src/contexts/matching/index.ts";
import { renderScoreMessage } from "../../../src/core/i18n/index.ts";
import { isPublicJobUrl } from "../../../src/core/job-url.ts";
import { trackFitsForJob } from "../../../src/core/scoring/apply.ts";
import { trackAction } from "../../actions";
import { Fit, Legend, ScoreBar, StatusBadge } from "../../ui";
import { candidateScope, requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import type { Translator } from "../../../src/core/i18n/index.ts";
import { LoadingRegion, SkeletonBar } from "../../skeleton";
import {
  applicationStatusLabel,
  applicationStatusLabels,
  applicationStatusOptions,
} from "../../status.ts";
import { TrackForm } from "./track-form";
import { TriageButton } from "../../triage-button";

export const dynamic = "force-dynamic";

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getTranslator();
  const session = await requirePage("job:read");
  const candidateId = candidateScope(session);

  const { id } = await params;
  // Link de fora com id não numérico é endereço errado, não incidente: `NaN`
  // chegando à consulta estoura no PostgreSQL e o 404 vira 500 no Sentry.
  const jobId = Number(id);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) notFound();
  const detail = await getJobDetail(candidateId, jobId);
  if (!detail) notFound();

  const { job, score, application, source } = detail;
  // A seção só existe com mais de uma trilha que pontua. Decidir isso antes da
  // fronteira, numa leitura barata, evita reservar espaço e anunciar espera
  // para uma seção que não vem — e o formulário do funil, logo abaixo, subir
  // quando o esboço some.
  const scoredTracks =
    candidateId === null
      ? 0
      : (await listCandidateTracks(candidateId)).filter((track) => track.status === "active" && track.target).length;
  const blockers = scoreMessages(score?.blockers);
  const matched = (score?.matchedKeywords as string[]) ?? [];
  const missing = (score?.missingKeywords as string[]) ?? [];
  const reasons = scoreMessages(score?.reasons);
  const externalUrl = isPublicJobUrl(job.url);
  const externalApplyUrl = isPublicJobUrl(job.applyUrl) ? job.applyUrl : null;

  return (
    <main className="pt-9 pb-16" data-testid="route-job-detail">
      <TransitionLink href="/jobs" data-testid="job-detail-back" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
        {t("jobDetail.back")}
      </TransitionLink>

      <header className="mt-4 mb-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 data-user-content className="type-display-md min-w-0 break-words text-balance">{job.title}</h1>
          {application && <StatusBadge status={application.status} t={t} />}
          {job.closedAt && <Badge variant="destructive">{t("jobDetail.closed")}</Badge>}
          {!externalUrl && <Badge variant="secondary">{t("compare.manualJob")}</Badge>}
        </div>
        {/* `data-user-content` nos três campos que vêm do acervo — empresa,
            localização e rótulo da fonte. "São Paulo, State of São Paulo,
            Brazil" continua acentuado com a interface em inglês, e sem a marca a
            guarda de vazamento leria isso como tradução esquecida. Foi por isso
            que esta tela ficou fora da guarda, e com ela ficaram três rótulos em
            português. O separador fica de fora da marca: é pontuação da
            interface, não texto do anúncio. */}
        <p className="mt-2 text-muted-foreground">
          <strong className="text-foreground" data-user-content>{job.companyName}</strong>
          {job.locationRaw ? <> · <span data-user-content>{job.locationRaw}</span></> : ""}
        </p>
        <p className="mt-1.5 font-mono type-meta text-muted-foreground">
          <span data-user-content>{source?.label ?? job.sourceId}</span> ·{" "}
          {t("jobDetail.seenOn")} {job.firstSeenAt.slice(0, 10)}
        </p>

        {/* Two destinations: the bare URL shows the description, /apply opens
            the form. Sending someone to a form for a job they have not read is
            the wrong default. */}
        {(externalUrl || candidateId !== null) && (
          <div className="mt-4 flex flex-wrap gap-2.5">
            {externalUrl && (
              <a
                href={job.url}
                target="_blank"
                rel="noopener"
                className={buttonVariants({ variant: "outline" })}
              >
                {t("jobDetail.openAtSource")}
              </a>
            )}
            {externalUrl && externalApplyUrl && externalApplyUrl !== job.url && (
              <a href={externalApplyUrl} target="_blank" rel="noopener" className={buttonVariants()}>
                {t("jobDetail.applyAtSource")}
              </a>
            )}
            {/* Quem abriu a vaga na origem e viu "US only" decide aqui mesmo. */}
            {candidateId !== null && (
              <TriageButton
                jobId={job.id}
                status={application?.status ?? null}
                appliedAt={application?.appliedAt ?? null}
                place="page"
                t={t}
              />
            )}
          </div>
        )}
        {externalUrl && <p className="mt-2 font-mono type-meta break-all text-muted-foreground">{job.url}</p>}
      </header>

      {score && (
        <Card className="mb-6">
          <CardContent className="pt-0">
            <div className="mb-3 flex items-center gap-3.5">
              <Fit value={score.fit} />
              <span className="text-sm text-muted-foreground">
                {t("jobDetail.outOfHundredCluster")}{" "}
                <span className="font-mono">{score.cluster}</span>
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
                  {t("compare.matchedKeywords")}: {matched.join(", ")}
                </p>
              </>
            )}
            {missing.length > 0 && (
              <p className="mt-1.5 font-mono type-meta text-muted-foreground">
                {t("compare.missingKeywords")}: {missing.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* A nota por trilha é calculada na hora para a trilha sem linha guardada,
          e é a leitura mais cara da tela: vem por streaming, sem segurar o
          cabeçalho, a nota principal e o formulário do funil. */}
      {candidateId !== null && scoredTracks > 1 && (
        <Suspense fallback={<SectionLoading label={t("jobDetail.loadingSection")} testId="job-track-fits-loading" />}>
          <TrackFits candidateId={candidateId} jobId={job.id} t={t} />
        </Suspense>
      )}

      {candidateId !== null && (
        // Sem `key` pelo status: remontar a cada mudança de estágio apagaria a
        // nota digitada justamente quando a recusa revalida a página. O reset do
        // que precisa ser resetado é explícito dentro do componente.
        <TrackForm
          action={trackAction}
          jobId={job.id}
          currentStatus={application?.status ?? null}
          options={applicationStatusOptions(
            t,
            locale,
            allowedTransitions(application?.status ?? null, application?.appliedAt ?? null),
          )}
          statusLabels={applicationStatusLabels(t)}
          labels={{
            moveTo: t("jobDetail.moveTo"),
            notePlaceholder: t("jobDetail.notePlaceholder"),
            save: t("jobDetail.saveStatus"),
            success: t("feedback.success"),
            error: t("feedback.error"),
            rejected: t("jobDetail.transitionRejected"),
            conflict: t("jobDetail.transitionConflict"),
          }}
        />
      )}

      {/* Só quem tem candidatura tem histórico, e a query já nega fora do
          escopo: sem candidatura nem a consulta é feita. */}
      {application && (
        <Suspense fallback={<SectionLoading label={t("jobDetail.loadingSection")} testId="application-timeline-loading" />}>
          <Timeline candidateId={candidateId} jobId={job.id} t={t} />
        </Suspense>
      )}

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

type SectionProps = { candidateId: number | null; jobId: number; t: Translator["t"] };

/** Espaço reservado de uma seção que chega por streaming. */
function SectionLoading({ label, testId }: { label: string; testId: string }) {
  return (
    <LoadingRegion label={label} testId={testId} className="mb-7 grid gap-3">
      <SkeletonBar className="h-6 w-1/3" />
      <SkeletonBar className="h-24 w-full" />
    </LoadingRegion>
  );
}

// Nota em cada trilha ativa; a que não tem linha é calculada agora e não é
// gravada (fora do portão de relevância, ou trilha recém-criada).
async function TrackFits({ candidateId, jobId, t }: SectionProps & { candidateId: number }) {
  const trackFits = await trackFitsForJob(candidateId, jobId);
  if (!trackFits || trackFits.length <= 1) return null;
  return (
    <section className="mb-7" data-testid="job-track-fits">
      <h2 className="type-display-xs mb-1">{t("jobDetail.trackFits")}</h2>
      <p className="mb-3 type-caption-md text-muted-foreground">{t("jobDetail.trackFitsLead")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {trackFits.map((fit) => (
          <Card key={fit.trackId} data-testid={`job-track-fit-${fit.trackId}`} data-computed={fit.computed ? "true" : "false"}>
            <CardContent className="grid gap-3 pt-0">
              <div className="flex flex-wrap items-center gap-3">
                <Fit value={fit.fit} />
                <span className="type-body-emphasis break-words" data-user-content>{fit.name}</span>
                {fit.isPrimary && <Badge>{t("tracks.primaryBadge")}</Badge>}
              </div>
              <ScoreBar parts={fit} t={t} />
              {fit.computed && (
                <p className="type-caption-sm text-muted-foreground" data-testid={`job-track-fit-computed-${fit.trackId}`}>
                  {t("jobDetail.computedFit")}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

async function Timeline({ candidateId, jobId, t }: SectionProps) {
  const timeline = await applicationTimeline(candidateId, jobId);
  if (timeline.length === 0) return null;
  return (
    <section className="mb-7" data-testid="application-timeline">
      <h2 className="type-display-xs mb-3">{t("jobDetail.history")}</h2>
      <Card>
        <CardContent className="pt-0">
          <ul className="divide-y divide-[var(--hairline)]">
            {timeline.map((event, index) => (
              <li key={`${event.at}-${index}`} className="py-3">
                <p className="type-caption-sm text-muted-foreground">
                  {event.at.slice(0, 10)}
                  {" · "}
                  {event.toStatus
                    ? event.fromStatus
                      ? t("jobDetail.historyMoved", {
                          from: applicationStatusLabel(event.fromStatus, t),
                          to: applicationStatusLabel(event.toStatus, t),
                        })
                      : t("jobDetail.historyStarted", {
                          to: applicationStatusLabel(event.toStatus, t),
                        })
                    : t("jobDetail.historyNote")}
                </p>
                {event.detail && (
                  <p className="type-body-sm mt-1" data-user-content>
                    {event.detail}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
