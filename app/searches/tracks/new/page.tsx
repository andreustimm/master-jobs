import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ensurePrimaryTrack,
  trackSuggestion,
  type TrackTarget,
} from "../../../../src/contexts/matching/index.ts";
import { requireOwnCandidatePage } from "../../../auth";
import { getTranslator } from "../../../i18n";
import { MutationFeedbackForm } from "../../../mutation-feedback";
import { TransitionLink } from "../../../transition-link";
import { createTrackAction } from "../../actions";
import { feedbackMessages } from "../../feedback";
import { TrackFieldset } from "../../track-fields";
import { targetToFields } from "../../track-form";
import { comVigia } from "../../../timeout-watch.ts";

export const dynamic = "force-dynamic";

/** A blank track on the primary's pay and seniority: titles and keywords are the candidate's. */
function blank(primary: TrackTarget): TrackTarget {
  return {
    targets: { clusters: {}, avoid_titles: [] },
    keywords: { critical: [], strong: [], stack: [], negative: [] },
    seniority: primary.seniority,
    compensation: primary.compensation,
  };
}

/**
 * A trilha sugerida para um termo, antes de existir.
 *
 * Nada é gravado ao abrir: a sugestão é montada no servidor e a pessoa edita e
 * confirma (ADR-002). Vindo da oferta da tela Vagas, o termo segue junto e é
 * salvo na trilha nova no mesmo envio.
 */
export default async function NewTrackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getTranslator();
  const { candidateId } = await requireOwnCandidatePage("candidate:read");
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const term = one("term");
  const name = one("name");

  const primary = await ensurePrimaryTrack(candidateId);
  // A outra tela que já devolveu 504 por disputa de conexão. O vigia não
  // corrige — faz o travamento deixar rastro, que é o que faltava.
  const suggestion = term
    ? await comVigia("/searches/tracks/new", () => trackSuggestion(candidateId, term))
    : null;
  const pending = !primary?.target;
  const target = suggestion?.ok ? suggestion.target : primary?.target ? blank(primary.target) : null;
  const fields = target ? targetToFields(name || (suggestion?.ok ? suggestion.term.term : ""), target) : null;

  return (
    <main className="page-content-top" data-testid="route-searches-new-track">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="type-display-md chevron">{t("tracks.newTitle")}</h1>
        <TransitionLink href="/searches" className="type-body-md text-[var(--primary-text)] hover:underline" data-testid="track-back">
          {t("tracks.back")}
        </TransitionLink>
      </div>

      {pending && (
        <Card className="mb-4 p-4" role="status" data-testid="track-pending">
          <p className="type-body-md">{t("searches.pendingPrimary")}</p>
        </Card>
      )}
      {suggestion && !suggestion.ok && suggestion.code !== "primary_pending" && (
        <Card className="mb-4 p-4" role="status" data-testid="track-term-invalid">
          <p className="type-body-md">{t(`searchFeedback.${suggestion.code}`)}</p>
        </Card>
      )}

      {suggestion?.ok && (
        <Card className="mb-4 gap-2 p-4" data-testid="track-suggestion">
          <p className="type-body-md">
            {t("tracks.suggestedFor")}: <strong data-user-content>{suggestion.term.term}</strong>
          </p>
          {suggestion.thin && <p className="type-body-md" data-testid="track-thin">{t("tracks.thin")}</p>}
          <p className="type-caption-md text-muted-foreground" data-testid="track-suggestion-evidence">
            {suggestion.support.supported.length > 0
              ? t("tracks.supported", { items: suggestion.support.supported.join(", ") })
              : t("tracks.noEvidence")}
            {suggestion.support.gaps.length > 0 ? ` · ${t("tracks.gaps", { items: suggestion.support.gaps.join(", ") })}` : ""}
          </p>
          {suggestion.inherited && <p className="type-caption-md text-muted-foreground">{t("tracks.inherited")}</p>}
        </Card>
      )}

      {fields && (
        <Card>
          <CardContent className="pt-6">
            <MutationFeedbackForm
              action={createTrackAction}
              successMessage={t("feedback.success")}
              errorMessage={t("feedback.error")}
              dismissLabel={t("feedback.dismiss")}
              resultMessages={feedbackMessages(t)}
              keepFields
              className="grid gap-4"
              data-testid="track-create-form"
            >
              {suggestion?.ok && <input type="hidden" name="term" value={suggestion.term.term} />}
              <TrackFieldset fields={fields} t={t} />
              <div>
                <Button type="submit" data-testid="track-create">{t("tracks.create")}</Button>
              </div>
            </MutationFeedbackForm>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
