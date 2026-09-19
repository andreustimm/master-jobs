import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, type TranslationKey, type Translator } from "../src/core/i18n/index.ts";
import {
  scoreQueueDisplay,
  type ScoreQueueDisplay,
  type ScoreQueueSnapshot,
} from "../src/core/scoring/queue.ts";

/**
 * O estado da repontuação do candidato, num card só.
 *
 * Mora fora da página do candidato porque a trilha também o usa: editar uma
 * trilha enfileira a repontuação dela, e quem abre a trilha ou o quadro por
 * ela precisa saber que as notas na tela são as ANTERIORES até a fila rodar.
 * Um segundo card com a mesma informação divergiria deste no primeiro ajuste.
 */

const QUEUE_STATE_KEYS = {
  idle: { label: "candidate.queueIdleLabel", detail: "candidate.queueIdle" },
  noCv: { label: "candidate.queueNoCvLabel", detail: "candidate.queueNoCv" },
  pending: { label: "candidate.queuePendingLabel", detail: "candidate.queuePending" },
  scoring: { label: "candidate.queueScoringLabel", detail: "candidate.queueScoring" },
  done: { label: "candidate.queueDoneLabel", detail: "candidate.queueDone" },
  failed: { label: "candidate.queueFailedLabel", detail: "candidate.queueFailed" },
} satisfies Record<ScoreQueueDisplay["state"], { label: TranslationKey; detail: TranslationKey }>;

const QUEUE_BADGE_VARIANT = {
  idle: "outline",
  noCv: "outline",
  pending: "secondary",
  scoring: "secondary",
  done: "default",
  failed: "destructive",
} as const satisfies Record<ScoreQueueDisplay["state"], "outline" | "secondary" | "default" | "destructive">;

/** A repontuação ainda não terminou: as notas mostradas são as anteriores. */
export function isRecalculating(snapshot: ScoreQueueSnapshot | null): boolean {
  const state = scoreQueueDisplay(snapshot, true).state;
  return state === "pending" || state === "scoring";
}

export function ScoreQueueCard({
  snapshot,
  hasCv,
  locale,
  t,
  recalculating = false,
}: {
  snapshot: ScoreQueueSnapshot | null;
  hasCv: boolean;
  locale: Translator["locale"];
  t: Translator["t"];
  /** Track context: say the fits on screen are the previous ones. */
  recalculating?: boolean;
}) {
  const display = scoreQueueDisplay(snapshot, hasCv);
  const keys = QUEUE_STATE_KEYS[display.state];
  const values = display.state === "done"
    ? { count: formatNumber(display.scored ?? 0, locale) }
    : undefined;

  return (
    <Card
      className="mb-6"
      data-testid="score-queue-status"
      data-state={display.state}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="type-body-emphasis" role="heading" aria-level={2}>
          {t("candidate.queueTitle")}
        </CardTitle>
        <Badge variant={QUEUE_BADGE_VARIANT[display.state]}>{t(keys.label)}</Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="type-body-sm max-w-[62ch] text-muted-foreground">
          {t(keys.detail, values)}
        </p>
        {recalculating && (
          <p className="type-body-sm mt-2 max-w-[62ch]" data-testid="track-recalculating">
            {t("tracks.recalculating")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
