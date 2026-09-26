import { TransitionLink } from "../../transition-link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  applicationTimeline,
  getJobDetail,
  transitionGroups,
  undoableEvent,
  type ApplicationStatus,
} from "../../../src/contexts/pursuit/index.ts";
import { listCandidateTracks, scoreMessages } from "../../../src/contexts/matching/index.ts";
import { renderScoreMessage } from "../../../src/core/i18n/index.ts";
import type { Availability } from "../../../src/core/ingest/availability.ts";
import { jobAvailability } from "../../../src/core/ingest/verdict.ts";
import { isPublicJobUrl } from "../../../src/core/job-url.ts";
import { trackFitsForJob } from "../../../src/core/scoring/apply.ts";
import { trackAction, undoTrackAction } from "../../actions";
import { Fit, Legend, ScoreBar, StatusBadge } from "../../ui";
import { candidateScope, mayAdminister, requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import type { Translator } from "../../../src/core/i18n/index.ts";
import { LoadingRegion, SkeletonBar } from "../../skeleton";
import {
  applicationStatusLabel,
  applicationStatusLabels,
  applicationStatusOptions,
} from "../../status.ts";
import { JobAnalysisSection } from "./job-analysis";
import { StageTrail } from "./stage-trail";
import { TrackForm } from "./track-form";
import { UndoButton, type UndoLabels } from "./undo";
import { TriageButton } from "../../triage-button";

export const dynamic = "force-dynamic";

/** Chave do dicionário por estado — texto nunca mora aqui (regra 9). */
const AVAILABILITY_LABEL = {
  open: "jobDetail.availabilityOpen",
  closed: "jobDetail.availabilityClosed",
  stale: "jobDetail.availabilityStale",
  unknown: "jobDetail.availabilityUnknown",
} as const satisfies Record<Availability, string>;

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getTranslator();
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
  const availability = await jobAvailability(job.id);
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
        {/* Só o que um evento de verificação prova: sem evento, "desconhecida";
            checagem velha, "vencida" — nunca "aberta" por omissão (#223). */}
        <p
          className="mt-1.5 type-meta text-muted-foreground"
          data-testid="job-availability"
          data-availability={availability.state}
          data-reason={availability.reason}
        >
          {/* O motivo é o que o evento prova: 404/410 é "encerrada na origem";
              fechada pelo sync, sem sondagem, é "saiu da listagem". */}
          {t(
            availability.state === "closed" && availability.reason !== "closed"
              ? "jobDetail.availabilityClosedListing"
              : AVAILABILITY_LABEL[availability.state],
          )}{" "}
          ·{" "}
          {availability.lastCheckedAt
            ? `${t("jobDetail.checkedOn")} ${availability.lastCheckedAt.slice(0, 10)}`
            : t("jobDetail.checkedNever")}
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
        <>
        <StageTrail current={application?.status ?? null} label={t("jobDetail.stageTrail")} t={t} />
        <TrackForm
          action={trackAction}
          undoAction={undoTrackAction}
          jobId={job.id}
          currentStatus={application?.status ?? null}
          groups={groupOptions(application?.status ?? null, t)}
          undoLabels={undoLabels(t)}
          statusLabels={applicationStatusLabels(t)}
          labels={{
            moveTo: t("jobDetail.moveTo"),
            notePlaceholder: t("jobDetail.notePlaceholder"),
            save: t("jobDetail.saveStatus"),
            success: t("feedback.success"),
            error: t("feedback.error"),
            rejected: t("jobDetail.transitionRejected"),
            conflict: t("jobDetail.transitionConflict"),
            groupForward: t("jobDetail.groupForward"),
            groupBack: t("jobDetail.groupBack"),
            groupClose: t("jobDetail.groupClose"),
            movedTo: t("jobDetail.movedTo"),
          }}
        />
        </>
      )}

      {/* Só quem tem candidatura tem histórico, e a query já nega fora do
          escopo: sem candidatura nem a consulta é feita. */}
      {application && (
        <Suspense fallback={<SectionLoading label={t("jobDetail.loadingSection")} testId="application-timeline-loading" />}>
          <Timeline
            candidateId={candidateId}
            jobId={job.id}
            t={t}
            current={{ status: application.status, appliedAt: application.appliedAt }}
          />
        </Suspense>
      )}

      {/* Leitura só da vaga, igual para todo papel que lê o acervo; custo e
          modelo só para admin, decidido pelo `can()` e não pela tela. */}
      <Suspense fallback={<SectionLoading label={t("jobDetail.loadingSection")} testId="job-analysis-loading" />}>
        <JobAnalysisSection jobId={job.id} admin={mayAdminister(session)} t={t} />
      </Suspense>

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

/** As opções do seletor, por grupo, na ordem do funil (#316). */
function groupOptions(current: ApplicationStatus | null, t: Translator["t"]) {
  const groups = transitionGroups(current);
  return {
    forward: applicationStatusOptions(t, groups.forward),
    back: applicationStatusOptions(t, groups.back),
    close: applicationStatusOptions(t, groups.close),
  };
}

function undoLabels(t: Translator["t"]): UndoLabels {
  return {
    undo: t("jobDetail.undo"),
    done: t("jobDetail.undoDone"),
    conflict: t("jobDetail.transitionConflict"),
    unavailable: t("jobDetail.undoUnavailable"),
    error: t("feedback.error"),
  };
}

/**
 * O histórico nunca é editado: o evento desfeito continua na lista, marcado, e
 * o desfazer aparece como uma linha própria. "Desfazer" fica só na
 * movimentação que o domínio desfaria agora (`undoableEvent`), e só para quem
 * pode mover o funil — a visão do recrutador lê sem botão.
 */
async function Timeline({
  candidateId,
  jobId,
  t,
  current,
}: SectionProps & { current: { status: ApplicationStatus; appliedAt: string | null } }) {
  const timeline = await applicationTimeline(candidateId, jobId);
  if (timeline.length === 0) return null;
  const changes = timeline.flatMap((event) =>
    event.kind === "status_change" && event.toStatus ? [{ ...event, toStatus: event.toStatus }] : [],
  );
  const reverted = new Set(changes.flatMap((event) => (event.revertsEventId === null ? [] : [event.revertsEventId])));
  const undoable = candidateId === null ? null : undoableEvent(current, changes);
  return (
    <section className="mb-7" data-testid="application-timeline">
      <h2 className="type-display-xs mb-3">{t("jobDetail.history")}</h2>
      <Card>
        <CardContent className="pt-0">
          <ul className="divide-y divide-[var(--hairline)]">
            {timeline.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3"
                data-testid="application-timeline-event"
                data-undone={reverted.has(event.id) ? "true" : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="type-caption-sm text-muted-foreground">
                    {event.at.slice(0, 10)}
                    {" · "}
                    <span className={reverted.has(event.id) ? "line-through" : undefined}>
                      {describeEvent(event, t)}
                    </span>
                    {reverted.has(event.id) && (
                      <>
                        {" · "}
                        <span data-testid="application-timeline-undone">{t("jobDetail.historyUndone")}</span>
                      </>
                    )}
                  </p>
                  {event.detail && (
                    <p className="type-body-sm mt-1" data-user-content>
                      {event.detail}
                    </p>
                  )}
                </div>
                {undoable?.id === event.id && (
                  <UndoButton
                    action={undoTrackAction}
                    jobId={jobId}
                    eventId={event.id}
                    labels={undoLabels(t)}
                    label={t("jobDetail.undoLatest")}
                  />
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

type TimelineEvent = Awaited<ReturnType<typeof applicationTimeline>>[number];

function describeEvent(event: TimelineEvent, t: Translator["t"]): string {
  if (!event.toStatus) return t("jobDetail.historyNote");
  const to = applicationStatusLabel(event.toStatus, t);
  if (!event.fromStatus) return t("jobDetail.historyStarted", { to });
  const from = applicationStatusLabel(event.fromStatus, t);
  return t(event.revertsEventId === null ? "jobDetail.historyMoved" : "jobDetail.historyUndo", { from, to });
}
