import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listCandidateTracks, trackSupport } from "../../../../src/contexts/matching/index.ts";
import { candidateScoreQueueStatus } from "../../../../src/core/scoring/queue.ts";
import { requireOwnCandidatePage } from "../../../auth";
import { getTranslator } from "../../../i18n";
import { MutationFeedbackForm } from "../../../mutation-feedback";
import { ScoreQueueCard, isRecalculating } from "../../../score-queue-card";
import { TransitionLink } from "../../../transition-link";
import { archiveTrackAction, restoreTrackAction, setPrimaryTrackAction, updateTrackAction } from "../../actions";
import { feedbackMessages } from "../../feedback";
import { TrackFieldset } from "../../track-fields";
import { targetToFields } from "../../track-form";

export const dynamic = "force-dynamic";

const FIELD_KEYS = {
  targets: "tracks.fieldTargets",
  compensation: "tracks.fieldCompensation",
  seniority: "tracks.fieldSeniority",
} as const;

/**
 * O editor de uma trilha.
 *
 * O id da URL é pedido, não prova: a trilha é procurada entre as do candidato
 * da sessão, e a de outra pessoa responde 404 — como a que não existe, porque
 * dizer "existe mas não é sua" já seria contar alguma coisa.
 */
export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getTranslator();
  const { candidateId } = await requireOwnCandidatePage("candidate:read");
  const { id } = await params;
  const trackId = Number(id);
  const track = Number.isInteger(trackId)
    ? (await listCandidateTracks(candidateId)).find((candidateTrack) => candidateTrack.id === trackId)
    : undefined;
  if (!track?.target) notFound();

  const [support, queue] = await Promise.all([trackSupport(candidateId, track.target), candidateScoreQueueStatus(candidateId)]);
  const feedback = {
    successMessage: t("feedback.success"),
    errorMessage: t("feedback.error"),
    dismissLabel: t("feedback.dismiss"),
    resultMessages: feedbackMessages(t),
  };

  return (
    <main className="page-content-top" data-testid="route-searches-track">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="type-display-md chevron">{t("tracks.editTitle")}</h1>
        <span className="type-display-xs break-words" data-user-content data-testid="track-title">{track.name}</span>
        {track.isPrimary && <Badge>{t("tracks.primaryBadge")}</Badge>}
        {track.status === "archived" && <Badge variant="outline">{t("searches.archived")}</Badge>}
        <TransitionLink href="/searches" className="type-body-md text-[var(--primary-text)] hover:underline" data-testid="track-back">
          {t("tracks.back")}
        </TransitionLink>
      </div>

      {isRecalculating(queue) && <ScoreQueueCard snapshot={queue} hasCv locale={locale} t={t} recalculating />}

      <Card className="mb-4 gap-2 p-4" data-testid="track-evidence">
        <p className="type-body-emphasis">{t("tracks.evidenceTitle")}</p>
        <p className="type-caption-md text-muted-foreground" data-testid="track-evidence-supported">
          {support.supported.length > 0 ? t("tracks.supported", { items: support.supported.join(", ") }) : t("tracks.noEvidence")}
        </p>
        {support.gaps.length > 0 && (
          <p className="type-caption-md text-muted-foreground" data-testid="track-evidence-gaps">
            {t("tracks.gaps", { items: support.gaps.join(", ") })}
          </p>
        )}
        {support.inherited && <p className="type-caption-md text-muted-foreground">{t("tracks.inherited")}</p>}
        {track.unreviewed.length > 0 && (
          <p className="type-caption-md" data-testid="track-unreviewed">
            {t("tracks.unreviewed", { fields: track.unreviewed.map((field) => t(FIELD_KEYS[field])).join(", ") })}
          </p>
        )}
      </Card>

      <Card className="mb-4">
        <CardContent className="pt-6">
          <MutationFeedbackForm
            action={updateTrackAction}
            {...feedback}
            keepFields
            className="grid gap-4"
            data-testid="track-edit-form"
          >
            <input type="hidden" name="trackId" value={track.id} />
            <input type="hidden" name="expectedUpdatedAt" value={track.updatedAt} />
            <TrackFieldset fields={targetToFields(track.name, track.target)} t={t} nameLocked={track.isPrimary} />
            <div>
              <Button type="submit" data-testid="track-save">{t("tracks.saveChanges")}</Button>
            </div>
          </MutationFeedbackForm>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {track.status === "active" && !track.isPrimary && (
          <MutationFeedbackForm action={setPrimaryTrackAction} {...feedback}>
            <input type="hidden" name="trackId" value={track.id} />
            <Button type="submit" variant="outline" data-testid="track-set-primary">{t("searches.setPrimary")}</Button>
          </MutationFeedbackForm>
        )}
        {track.status === "active" && !track.isPrimary && (
          <MutationFeedbackForm action={archiveTrackAction} {...feedback}>
            <input type="hidden" name="trackId" value={track.id} />
            <Button type="submit" variant="outline" data-testid="track-archive">{t("searches.archive")}</Button>
          </MutationFeedbackForm>
        )}
        {track.status === "archived" && (
          <MutationFeedbackForm action={restoreTrackAction} {...feedback}>
            <input type="hidden" name="trackId" value={track.id} />
            <Button type="submit" variant="outline" data-testid="track-restore">{t("searches.restore")}</Button>
          </MutationFeedbackForm>
        )}
      </div>
    </main>
  );
}
