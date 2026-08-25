import { TransitionLink } from "../transition-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  analyseGap,
  currentDocument,
  documentHistory,
  getCandidateById,
} from "../../src/core/candidate.ts";
import { MarkdownEditor } from "./editor";
import { VersionHistory } from "./versions";
import { importPdfAction, saveCvAction, setVisibilityAction } from "./actions";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";
import { formatNumber, type TranslationKey, type Translator } from "../../src/core/i18n/index.ts";
import type { Visibility } from "../../src/contexts/auth/index.ts";
import { cn } from "@/lib/utils";
import { MutationFeedbackForm } from "../mutation-feedback";
import {
  candidateScoreQueueStatus,
  scoreQueueDisplay,
  type ScoreQueueDisplay,
  type ScoreQueueSnapshot,
} from "../../src/core/scoring/queue.ts";

export const dynamic = "force-dynamic";

/**
 * Quem alcança este perfil.
 *
 * Fica ACIMA do currículo de propósito: é a decisão que governa tudo o que vem
 * depois, e enterrá-la no rodapé produziria o pior caso possível — alguém que
 * tornou o perfil público sem perceber e não tem motivo para rolar até lá para
 * descobrir.
 *
 * O estado corrente aparece marcado, e `public` carrega o aviso do que
 * significa. "Público" soa inofensivo; "legível por qualquer um, buscadores
 * inclusive" não.
 */
function VisibilityCard({
  current,
  publicCv,
  slug,
  t,
}: {
  current: string;
  publicCv: boolean;
  slug: string;
  t: Translator["t"];
}) {
  const options = [
    { id: "private" as const, label: "visibility.private", hint: "visibility.privateHint" },
    { id: "recruiters" as const, label: "visibility.recruiters", hint: "visibility.recruitersHint" },
    { id: "public" as const, label: "visibility.public", hint: "visibility.publicHint" },
  ] satisfies { id: Visibility; label: TranslationKey; hint: TranslationKey }[];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">{t("visibility.title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <MutationFeedbackForm
          action={setVisibilityAction}
          successMessage={t("feedback.success")}
          errorMessage={t("feedback.error")}
          dismissLabel={t("feedback.dismiss")}
          className="grid gap-2"
        >
          {options.map((option) => (
            <label
              key={option.id}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-action)] border p-3 transition-colors",
                current === option.id
                  ? "border-[var(--primary)] bg-[var(--muted)]"
                  : "border-[var(--hairline)] hover:bg-[var(--muted)]",
              )}
            >
              <input
                type="radio"
                name="visibility"
                value={option.id}
                defaultChecked={current === option.id}
                className="mt-1 cursor-pointer"
              />
              <span className="min-w-0">
                <span className="type-body-md block font-medium">
                  {t(option.label)}
                  {current === option.id && (
                    <span className="ml-2 type-micro text-muted-foreground">
                      ({t("visibility.current")})
                    </span>
                  )}
                </span>
                <span className="type-body-sm block text-muted-foreground">{t(option.hint)}</span>
              </span>
            </label>
          ))}

          {/* Segundo consentimento, separado do primeiro.
              "Público" diz alcançável sem sessão; publicar o currículo inteiro
              é outra decisão, e derivá-la da primeira é como se publica um CV
              sem querer. */}
          <label className="mt-1 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              name="publicCv"
              defaultChecked={publicCv}
              className="mt-1 cursor-pointer"
            />
            <span className="min-w-0">
              <span className="type-body-md block font-medium">{t("visibility.publishCv")}</span>
              <span className="type-body-sm block text-muted-foreground">
                {t("visibility.publishCvHint")}
              </span>
            </span>
          </label>

          {current === "public" && (
            <p className="type-meta text-muted-foreground">
              {t("visibility.publicLink")}:{" "}
              <TransitionLink
                href={`/p/${slug}`}
                prefetch={false}
                className="font-mono text-[var(--primary-text)] hover:underline"
              >
                /p/{slug}
              </TransitionLink>
            </p>
          )}

          {/* O aviso fica sempre visível, e não só quando `public` está
              marcado: quem já está público precisa lê-lo mais do que quem está
              prestes a ficar. */}
          <p className="type-body-sm mt-1 text-[var(--warn)]">{t("visibility.publicWarning")}</p>
          <p className="type-meta text-muted-foreground">{t("visibility.neverShown")}</p>

          <div>
            <Button type="submit" size="sm" variant="outline" data-testid="save-visibility">
              {t("visibility.save")}
            </Button>
          </div>
        </MutationFeedbackForm>
      </CardContent>
    </Card>
  );
}

/**
 * Rótulos do histórico, já traduzidos.
 *
 * O modal é ilha de cliente e o tradutor tem métodos — método não atravessa a
 * fronteira do Server Component. Um mapa plano de strings atravessa, e mantém
 * o i18n do lado servidor como no resto da aplicação.
 */
const VERSION_KEYS = [
  "title", "open", "empty", "close", "cancel", "current", "chars", "view",
  "restore", "rename", "remove", "save", "newLabel", "restoredSuffix",
  "rendered", "raw", "sameAsCurrent", "deltaMore", "deltaLess",
  "confirmDelete", "confirmRestore", "errorNotFound", "errorEmptyLabel",
  "errorLabelTooLong", "errorIsCurrent", "errorReferenced", "referencedBy",
] as const;

function versionLabels(t: Translator["t"]): Record<string, string> {
  return Object.fromEntries(VERSION_KEYS.map((key) => [key, t(`versions.${key}`)]));
}

const QUEUE_STATE_KEYS = {
  idle: { label: "candidate.queueIdleLabel", detail: "candidate.queueIdle" },
  pending: { label: "candidate.queuePendingLabel", detail: "candidate.queuePending" },
  scoring: { label: "candidate.queueScoringLabel", detail: "candidate.queueScoring" },
  done: { label: "candidate.queueDoneLabel", detail: "candidate.queueDone" },
  failed: { label: "candidate.queueFailedLabel", detail: "candidate.queueFailed" },
} satisfies Record<ScoreQueueDisplay["state"], { label: TranslationKey; detail: TranslationKey }>;

const QUEUE_BADGE_VARIANT = {
  idle: "outline",
  pending: "secondary",
  scoring: "secondary",
  done: "default",
  failed: "destructive",
} as const satisfies Record<ScoreQueueDisplay["state"], "outline" | "secondary" | "default" | "destructive">;

function ScoreQueueCard({
  snapshot,
  hasCv,
  locale,
  t,
}: {
  snapshot: ScoreQueueSnapshot | null;
  hasCv: boolean;
  locale: Translator["locale"];
  t: Translator["t"];
}) {
  const display = scoreQueueDisplay(hasCv ? snapshot : null);
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
      </CardContent>
    </Card>
  );
}

export default async function CandidateArea() {
  const { t, locale } = await getTranslator();
  // Guard antes de ler qualquer dado. O escopo vem da sessão.
  const { candidateId } = await requireOwnCandidatePage("candidate:read");

  const person = await getCandidateById(candidateId);
  const queueSnapshot = await candidateScoreQueueStatus(candidateId);
  const doc = person ? await currentDocument(person.id, "cv") : null;
  const history = person ? await documentHistory(person.id, "cv") : [];
  const gap = await analyseGap({ candidateId, minFit: 60 });

  return (
    <main className="pt-10 pb-16" data-testid="route-candidate">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="type-display-md chevron">{t("candidate.title")}</h1>
        <TransitionLink href="/candidate/skills" data-testid="candidate-skills-link" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("candidate.toSkills")}
        </TransitionLink>
        <TransitionLink href="/candidate/vocabulary" data-testid="candidate-vocabulary-link" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("candidate.toVocabulary")}
        </TransitionLink>
      </div>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.candidateLead")}{" "}
        <strong className="text-foreground">
          {t("copy.vocabularyLead")}
        </strong>
        .
      </p>

      {person && (
        <VisibilityCard
          current={person.visibility}
          publicCv={person.publicCv}
          slug={person.slug}
          t={t}
        />
      )}

      {person && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{person.name}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            {/* Dado do usuário: `profile.yaml` está no idioma dele, e continua
                assim com a interface em inglês. Ver a nota em `tests/e2e`. */}
            {person.headline && (
              <p data-user-content className="text-foreground">
                {person.headline}
              </p>
            )}
            <p data-user-content className="mt-1">
              {[person.location, person.email].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 font-mono type-meta">
              {t("copy.identityFrom", { file: "profile/profile.yaml" })}
            </p>
          </CardContent>
        </Card>
      )}

      <ScoreQueueCard
        snapshot={queueSnapshot}
        hasCv={doc !== null}
        locale={locale}
        t={t}
      />

      <MutationFeedbackForm
        action={importPdfAction}
        successMessage={t("feedback.success")}
        errorMessage={t("feedback.error")}
        dismissLabel={t("feedback.dismiss")}
        className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-cloud)] p-4"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="file">{t("candidate.importPdf")}</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
            className="max-w-[320px]"
          />
        </div>
        <Button type="submit" variant="outline">
          {t("candidate.extractText")}
        </Button>
        <p className="type-body-sm w-full text-muted-foreground">
          {t("copy.pdfNewVersion")}{" "}
          <strong className="text-foreground">{t("copy.pdfReviewFirst")}</strong>.{" "}
          {t("copy.pdfCaveat")}
        </p>
      </MutationFeedbackForm>

      <MutationFeedbackForm
        action={saveCvAction}
        successMessage={t("feedback.success")}
        errorMessage={t("feedback.error")}
        dismissLabel={t("feedback.dismiss")}
        className="mb-8 grid gap-3"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="label">{t("candidate.versionLabel")}</Label>
          <Input
            id="label"
            name="label"
            placeholder="ATS EN 2026-08"
            defaultValue={doc?.label ?? ""}
            className="max-w-[320px]"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="content">{t("candidate.cvMarkdown")}</Label>
          <MarkdownEditor
            name="content"
            defaultValue={doc?.content ?? ""}
            labels={{
              field: t("candidate.cvMarkdown"),
              edit: t("candidate.edit"),
              split: t("candidate.split"),
              preview: t("candidate.preview"),
              viewMode: t("candidate.viewMode"),
              vimHint: t("candidate.vimHint"),
              nothingToShow: t("candidate.nothingToShow"),
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" data-testid="save-cv">{t("candidate.save")}</Button>
          {doc && (
            <span className="text-xs text-muted-foreground">
              {t("candidate.current")}: {" "}
              <strong data-user-content className="text-foreground">{doc.label}</strong> ·{" "}
              {formatNumber(doc.content.length, locale)} {t("candidate.chars")} ·{" "}
              {t("candidate.savedOn")} {" "}
              {doc.createdAt.slice(0, 10)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("copy.pdfUploadTodo", { fields: "format, source_filename" })}
        </p>
      </MutationFeedbackForm>

      {gap && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="type-display-sm mb-2">
              {t("copy.vocabularyGapTitle")}
            </h2>
            <p className="mb-5 text-sm text-muted-foreground">
              {t("copy.vocabularyCompared", { jobs: gap.jobsAnalysed, cut: gap.minFit })}</p>

            {gap.missing.length === 0 ? (
              <Card className="p-5 text-sm text-muted-foreground">
                {t("candidate.noRelevantGap")}
              </Card>
            ) : (
              <div className="mb-8 grid gap-2">
                {gap.missing.slice(0, 18).map((term) => (
                  <div
                    key={term.term}
                    className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate sm:min-w-[190px] sm:flex-none font-mono text-sm">{term.term}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-border">
                      <span
                        className="block h-full rounded-sm bg-[var(--color-mid)]"
                        style={{ width: `${Math.round(term.coverage * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {Math.round(term.coverage * 100)}%
                      <span className="hidden sm:inline"> {t("candidate.ofJobs")}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <details className="mb-6">
              <summary className="cursor-pointer text-sm font-medium">
                {t("copy.vocabularyWorking")} ({gap.confirmed.length})
              </summary>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {gap.confirmed.map((term) => (
                  <Badge key={term.term} variant="secondary" className="font-mono type-meta">
                    {term.term} · {Math.round(term.coverage * 100)}%
                  </Badge>
                ))}
              </div>
            </details>

            {gap.unused.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  {t("copy.vocabularyRareTitle")} ({gap.unused.length})
                </summary>
                <p className="mt-2 mb-3 max-w-[62ch] text-xs text-muted-foreground">
                  {t("copy.vocabularyRareNote")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {gap.unused.map((term) => (
                    <Badge key={term.term} variant="outline" className="font-mono type-meta">
                      {term.term}
                    </Badge>
                  ))}
                </div>
              </details>
            )}
          </section>
        </>
      )}

      {!gap && (
        <Card className="p-5 text-sm text-muted-foreground">
          {t("candidate.gapEmpty")}
        </Card>
      )}

      {history.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="type-display-xs">{t("candidate.versions")}</h2>
              {/* A lista abaixo é leitura; as operações moram no modal. Ver e
                  restaurar são decisões que merecem foco e confirmação, não um
                  clique perdido no meio de uma página longa. */}
              <VersionHistory
                rows={history.map((h) => ({
                  id: h.id,
                  label: h.label,
                  isCurrent: h.isCurrent,
                  length: h.length,
                  createdAt: h.createdAt,
                }))}
                currentLength={doc?.content.length ?? 0}
                locale={locale}
                labels={versionLabels(t)}
                feedback={{
                  success: t("feedback.success"),
                  error: t("feedback.error"),
                }}
              />
            </div>
            <div className="divide-y overflow-hidden rounded-xl border">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 bg-card px-4 py-2.5 text-sm">
                  {h.isCurrent ? (
                    <Badge className="type-micro">{t("candidate.current")}</Badge>
                  ) : (
                    <span className="w-[46px]" />
                  )}
                  <span data-user-content className="flex-1">{h.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatNumber(h.length, locale)} {t("candidate.chars")}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {h.createdAt.slice(0, 10)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
