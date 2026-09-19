import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  termOverview,
  trackOverview,
  type TermView,
} from "../../src/contexts/matching/index.ts";
import { termSearchPlatforms, type PlatformCaptureState } from "../../src/contexts/sourcing/index.ts";
import type { TranslationKey, Translator } from "../../src/core/i18n/index.ts";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";
import { MutationFeedbackForm } from "../mutation-feedback";
import { TransitionLink } from "../transition-link";
import {
  archiveTrackAction,
  deleteTermAction,
  moveTermAction,
  pauseTermAction,
  rerunTermAction,
  restoreTrackAction,
  resumeTermAction,
  saveTermAction,
  setPrimaryTrackAction,
} from "./actions";
import { feedbackMessages } from "./feedback";

export const dynamic = "force-dynamic";

/** Native select dressed as the design system's input: no client JS needed. */
const SELECT = "h-9 rounded-md border border-input bg-background px-2 type-body-md text-foreground";

function when(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(iso),
  ) + " UTC";
}

type PlatformLine = { platform: string; label: string; detail?: string };

function platformLines(
  term: TermView,
  fallback: "captures_off" | "waiting_sweep",
  platforms: readonly string[],
  t: Translator["t"],
  locale: string,
): PlatformLine[] {
  if (term.platforms.length === 0) {
    return platforms.map((platform) => ({ platform, label: t(`captureState.${fallback}`) }));
  }
  return term.platforms.map((state: PlatformCaptureState) => {
    let detail: string | undefined;
    if (state.status === "succeeded") {
      detail = t("searches.counts", { fetched: state.fetched, created: state.created, attributed: state.attributed });
      if (state.totalHint !== null && state.totalHint > state.fetched) {
        detail += ` · ${t("searches.totalHint", { shown: state.fetched, total: state.totalHint })}`;
      }
    } else if (state.status === "waiting_quota" && state.retryAt) {
      detail = t("searches.waitingQuota", { when: when(state.retryAt, locale) });
    } else if ((state.status === "failed" || state.status === "skipped") && state.reasonCode) {
      const key = REASON_KEYS[state.reasonCode as keyof typeof REASON_KEYS];
      detail = key ? t(key) : state.reasonCode;
    }
    return { platform: state.platform, label: t(`captureState.${state.status}`), detail };
  });
}

const REASON_KEYS = {
  http_error: "captureReason.http_error",
  network: "captureReason.network",
  parse: "captureReason.parse",
  endpoint_gone: "captureReason.endpoint_gone",
  platform_disabled: "captureReason.platform_disabled",
  ingestion_blocked: "captureReason.ingestion_blocked",
  quota: "captureReason.quota",
} as const satisfies Record<string, TranslationKey>;

export default async function SearchesPage() {
  const { t, locale } = await getTranslator();
  // Guard antes de ler qualquer dado. O escopo vem da sessão: termos e trilhas
  // são do candidato e de mais ninguém (ADR-006).
  const { session, candidateId } = await requireOwnCandidatePage("candidate:read");
  const now = new Date();
  const [tracks, terms] = await Promise.all([trackOverview(candidateId), termOverview({ candidateId }, now)]);
  const platforms = termSearchPlatforms();
  const impersonated = session.impersonatedBy !== null;
  // Sessão emprestada nunca dispara busca: o que ela salva espera a varredura.
  const fallback = impersonated || !terms.capturesOff ? "waiting_sweep" : "captures_off";
  const messages = feedbackMessages(t);
  const active = tracks.tracks.filter((track) => track.status === "active" && track.target);
  const feedback = {
    successMessage: t("feedback.success"),
    errorMessage: t("feedback.error"),
    dismissLabel: t("feedback.dismiss"),
    resultMessages: messages,
  };

  return (
    <main className="page-content-top" data-testid="route-searches">
      <header className="pb-4">
        <h1 className="type-display-md chevron mb-4">{t("searches.title")}</h1>
        <p className="type-body-md max-w-[62ch] text-muted-foreground">{t("searches.lead")}</p>
        <p className="type-caption-md mt-2 max-w-[62ch] text-muted-foreground" data-testid="searches-coverage">
          {t("searches.coverage")}
        </p>
      </header>

      {(tracks.pending || terms.capturesOff || terms.dailyRepeatPaused) && (
        <Card className="mb-4 gap-1 p-4" role="status" data-testid="searches-notices">
          {tracks.pending && <p className="type-body-md" data-testid="searches-pending">{t("searches.pendingPrimary")}</p>}
          {terms.capturesOff && <p className="type-body-md" data-testid="searches-captures-off">{t("searches.capturesOff")}</p>}
          {terms.dailyRepeatPaused && (
            <p className="type-body-md" data-testid="searches-daily-paused">{t("searches.dailyRepeatPaused")}</p>
          )}
        </Card>
      )}

      {!tracks.pending && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="type-body-emphasis" role="heading" aria-level={2}>
              {t("searches.saveTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <MutationFeedbackForm
              action={saveTermAction}
              {...feedback}
              resultLinkLabel={t("searchFeedback.viewExisting")}
              className="flex flex-wrap items-end gap-2"
              data-testid="searches-save-form"
            >
              <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 type-caption-sm text-muted-foreground">
                {t("searches.term")}
                <Input name="term" required maxLength={60} data-testid="searches-term-input" />
              </label>
              <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
                {t("searches.track")}
                <select name="trackId" className={SELECT} data-testid="searches-term-track">
                  {active.map((track) => (
                    <option key={track.id} value={track.id} data-user-content>
                      {track.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" data-testid="searches-term-save">{t("searches.save")}</Button>
            </MutationFeedbackForm>
          </CardContent>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-display-xs">{t("searches.tracksTitle")}</h2>
        <TransitionLink
          href="/searches/tracks/new"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          data-testid="searches-new-track"
        >
          {t("searches.newTrack")}
        </TransitionLink>
      </div>

      <div className="grid gap-4">
        {tracks.tracks.map((track) => {
          const own = terms.terms.filter((term) => term.trackId === track.id);
          return (
            <Card key={track.id} data-testid={`track-${track.id}`} data-primary={track.isPrimary ? "true" : "false"}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <CardTitle className="type-body-emphasis break-words" role="heading" aria-level={3} data-user-content>
                    {track.name}
                  </CardTitle>
                  {track.isPrimary && <Badge data-testid={`track-primary-${track.id}`}>{t("searches.primary")}</Badge>}
                  {track.status === "archived" && <Badge variant="outline">{t("searches.archived")}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {track.target && (
                    <TransitionLink
                      href={`/searches/tracks/${track.id}` as Route}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      data-testid={`track-edit-${track.id}`}
                    >
                      {t("searches.edit")}
                    </TransitionLink>
                  )}
                  {track.status === "active" && !track.isPrimary && (
                    <MutationFeedbackForm action={setPrimaryTrackAction} {...feedback}>
                      <input type="hidden" name="trackId" value={track.id} />
                      <Button type="submit" variant="outline" size="sm" data-testid={`track-set-primary-${track.id}`}>
                        {t("searches.setPrimary")}
                      </Button>
                    </MutationFeedbackForm>
                  )}
                  {track.status === "active" && !track.isPrimary && (
                    <MutationFeedbackForm action={archiveTrackAction} {...feedback}>
                      <input type="hidden" name="trackId" value={track.id} />
                      <Button type="submit" variant="outline" size="sm" data-testid={`track-archive-${track.id}`}>
                        {t("searches.archive")}
                      </Button>
                    </MutationFeedbackForm>
                  )}
                  {track.status === "archived" && (
                    <MutationFeedbackForm action={restoreTrackAction} {...feedback}>
                      <input type="hidden" name="trackId" value={track.id} />
                      <Button type="submit" variant="outline" size="sm" data-testid={`track-restore-${track.id}`}>
                        {t("searches.restore")}
                      </Button>
                    </MutationFeedbackForm>
                  )}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0">
                {track.target && (
                  <p className="type-caption-md text-muted-foreground" data-testid={`track-evidence-${track.id}`}>
                    {track.support.supported.length > 0
                      ? t("tracks.supported", { items: track.support.supported.join(", ") })
                      : t("tracks.noEvidence")}
                  </p>
                )}
                {track.unreviewed.length > 0 && (
                  <p className="type-caption-md" data-testid={`track-unreviewed-${track.id}`}>
                    {t("tracks.unreviewed", {
                      fields: track.unreviewed.map((field) => t(FIELD_KEYS[field])).join(", "),
                    })}
                  </p>
                )}
                {own.length === 0 && <p className="type-body-md text-muted-foreground">{t("searches.noTerms")}</p>}
                {own.map((term) => {
                  const lines = platformLines(term, fallback, platforms, t, locale);
                  const lastRun = term.platforms
                    .map((state) => state.finishedAt)
                    .filter((value): value is string => value !== null)
                    .sort()
                    .at(-1);
                  return (
                    <div
                      key={term.id}
                      id={`term-${term.id}`}
                      className="grid gap-2 rounded-md border p-3"
                      data-testid={`term-${term.id}`}
                      data-state={term.status}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="type-body-emphasis break-words" data-user-content>
                          {term.term}
                        </span>
                        {term.status === "paused" && (
                          <Badge variant="outline" data-testid={`term-paused-${term.id}`}>
                            {t("searches.paused")}
                          </Badge>
                        )}
                        {term.notice === "no_results_14d" && (
                          <Badge variant="outline" data-testid={`term-no-results-${term.id}`}>
                            {t("searches.noResults14d")}
                          </Badge>
                        )}
                        <TransitionLink
                          href={`/jobs?by=${term.id}&fit=0` as Route}
                          className="type-caption-md text-[var(--primary-text)] hover:underline"
                          data-testid={`term-new-${term.id}`}
                          data-count={term.newCount}
                        >
                          {t("searches.newJobs", { count: term.newCount })} · {t("searches.viewJobs")}
                        </TransitionLink>
                      </div>
                      <ul className="grid gap-1" data-testid={`term-platforms-${term.id}`}>
                        {lines.map((line) => (
                          <li key={line.platform} className="type-caption-md text-muted-foreground">
                            <span className="font-mono text-foreground">{line.platform}</span> · {line.label}
                            {line.detail ? ` — ${line.detail}` : ""}
                          </li>
                        ))}
                      </ul>
                      <p className="type-caption-md text-muted-foreground">
                        {lastRun ? `${t("searches.lastRun", { when: when(lastRun, locale) })} · ` : ""}
                        {term.reused ? `${t("searches.reused")} · ` : ""}
                        {t("searches.nextRunSweep")}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <MutationFeedbackForm action={rerunTermAction} {...feedback}>
                          <input type="hidden" name="termId" value={term.id} />
                          <Button type="submit" variant="outline" size="sm" data-testid={`term-rerun-${term.id}`}>
                            {term.rerun.allowed
                              ? t("searches.rerun")
                              : t("searches.rerunAt", { when: when(term.rerun.availableAt, locale) })}
                          </Button>
                        </MutationFeedbackForm>
                        <MutationFeedbackForm
                          action={term.status === "paused" ? resumeTermAction : pauseTermAction}
                          {...feedback}
                        >
                          <input type="hidden" name="termId" value={term.id} />
                          <Button type="submit" variant="outline" size="sm" data-testid={`term-toggle-${term.id}`}>
                            {term.status === "paused" ? t("searches.resume") : t("searches.pause")}
                          </Button>
                        </MutationFeedbackForm>
                        {active.length > 1 && (
                          <MutationFeedbackForm action={moveTermAction} {...feedback} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="termId" value={term.id} />
                            <label className="flex items-center gap-2 type-caption-sm text-muted-foreground">
                              {t("searches.moveTo")}
                              <select
                                name="trackId"
                                defaultValue={term.trackId}
                                className={SELECT}
                                data-testid={`term-move-track-${term.id}`}
                              >
                                {active.map((option) => (
                                  <option key={option.id} value={option.id} data-user-content>
                                    {option.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Button type="submit" variant="outline" size="sm" data-testid={`term-move-${term.id}`}>
                              {t("searches.move")}
                            </Button>
                          </MutationFeedbackForm>
                        )}
                        <MutationFeedbackForm action={deleteTermAction} {...feedback}>
                          <input type="hidden" name="termId" value={term.id} />
                          <Button type="submit" variant="outline" size="sm" data-testid={`term-delete-${term.id}`}>
                            {t("searches.delete")}
                          </Button>
                        </MutationFeedbackForm>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}

const FIELD_KEYS = {
  targets: "tracks.fieldTargets",
  compensation: "tracks.fieldCompensation",
  seniority: "tracks.fieldSeniority",
} as const;
