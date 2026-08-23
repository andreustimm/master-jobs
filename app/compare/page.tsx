import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getComparisonDetail, scoreMessages } from "../../src/contexts/matching/index.ts";
import { currentDocument } from "../../src/core/candidate.ts";
import {
  formatDate,
  renderScoreMessage,
  type TranslationKey,
  type Translator,
} from "../../src/core/i18n/index.ts";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";
import { Fit, Legend, ScoreBar } from "../ui";
import { CompareForm, type CompareFormLabels } from "./form";
import type { CompareErrorCode } from "./form-state";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ job?: string | string[] }>;

function formLabels(t: Translator["t"]): CompareFormLabels {
  const errorKeys: Record<CompareErrorCode, TranslationKey> = {
    required: "compare.errorRequired",
    "too-long": "compare.errorTooLong",
    "invalid-url": "compare.errorInvalidUrl",
    "missing-source": "compare.errorMissingSource",
    "multiple-sources": "compare.errorMultipleSources",
    "file-empty": "compare.errorFileEmpty",
    "file-too-large": "compare.errorFileTooLarge",
    "unsupported-file": "compare.errorUnsupportedFile",
    "file-not-text": "compare.errorFileNotText",
    "description-too-short": "compare.errorDescriptionTooShort",
    "description-too-long": "compare.errorDescriptionTooLong",
    "extraction-failed": "compare.errorExtractionFailed",
    unexpected: "compare.errorUnexpected",
  };

  return {
    formTitle: t("compare.formTitle"),
    role: t("compare.role"),
    rolePlaceholder: t("compare.rolePlaceholder"),
    company: t("compare.company"),
    companyPlaceholder: t("compare.companyPlaceholder"),
    location: t("compare.location"),
    locationPlaceholder: t("compare.locationPlaceholder"),
    url: t("compare.url"),
    urlPlaceholder: t("compare.urlPlaceholder"),
    description: t("compare.description"),
    descriptionPlaceholder: t("compare.descriptionPlaceholder"),
    descriptionHint: t("compare.descriptionHint"),
    or: t("compare.or"),
    file: t("compare.file"),
    fileHint: t("compare.fileHint"),
    submit: t("compare.submit"),
    pending: t("compare.pending"),
    errors: Object.fromEntries(
      Object.entries(errorKeys).map(([code, key]) => [code, t(key)]),
    ) as Record<CompareErrorCode, string>,
  };
}

export default async function CompareJobPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ t, locale }, { candidateId }] = await Promise.all([
    getTranslator(),
    requireOwnCandidatePage("candidate:read"),
  ]);

  const params = await searchParams;
  const rawJobId = Array.isArray(params.job) ? params.job[0] : params.job;
  const jobId = rawJobId && /^\d+$/.test(rawJobId) ? Number(rawJobId) : null;

  const [cv, detail] = await Promise.all([
    currentDocument(candidateId, "cv"),
    jobId === null ? null : getComparisonDetail(candidateId, jobId),
  ]);

  const vocabulary = detail?.vocabulary ?? null;
  const metadata = detail?.metadata ?? null;
  const manualJob = detail?.manualJob ?? false;
  const externalUrl = detail?.externalUrl ?? null;
  const score = detail?.score ?? null;
  const blockers = scoreMessages(score?.blockers);
  const reasons = scoreMessages(score?.reasons);
  const matched = (score?.matchedKeywords as string[] | null) ?? [];
  const missing = (score?.missingKeywords as string[] | null) ?? [];
  const covered = vocabulary?.items.filter((item) => item.kind === "covered") ?? [];

  return (
    <main className="page-content-top pb-16">
      <header className="mb-6">
        <p className="font-mono type-micro tracking-[.12em] text-[var(--primary-text)] uppercase">
          {t("compare.eyebrow")}
        </p>
        <h1 className="type-display-md chevron mt-2">{t("compare.title")}</h1>
        <p className="type-body-md mt-3 max-w-[68ch] text-muted-foreground">
          {t("compare.lead")}
        </p>
      </header>

      <Card size="sm" className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          {cv ? (
            <div>
              <p className="font-medium">{t("compare.currentCv")}</p>
              <p data-user-content className="type-caption-sm mt-1 text-muted-foreground">
                {cv.label} · {formatDate(cv.createdAt, locale)}
              </p>
            </div>
          ) : (
            <div>
              <p className="font-medium">
                {t("compare.noCvTitle")}
              </p>
              <p className="type-caption-sm mt-1 text-muted-foreground">
                {t("compare.noCvHint")}
              </p>
            </div>
          )}
          <Link href="/candidate" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("compare.openCandidate")}
          </Link>
        </CardContent>
      </Card>

      <div className={cn("grid gap-6", detail && "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]")}>
        <CompareForm labels={formLabels(t)} />

        {rawJobId && !detail && (
          <Card id="comparison-result" className="border-destructive/40">
            <CardContent className="text-destructive">{t("compare.resultNotFound")}</CardContent>
          </Card>
        )}

        {detail && (
          <section
            id="comparison-result"
            data-testid="comparison-result"
            className="min-w-0 space-y-6 scroll-mt-6"
          >
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  {manualJob && <Badge variant="secondary">{t("compare.manualJob")}</Badge>}
                  {score && <Badge variant="outline">{score.cluster}</Badge>}
                </div>
                <CardTitle data-user-content className="type-display-xs mt-2">
                  {detail.job.title}
                </CardTitle>
                <CardDescription data-user-content>
                  {detail.job.companyName}
                  {detail.job.locationRaw ? ` · ${detail.job.locationRaw}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {score ? (
                  <>
                    <div data-testid="comparison-score" className="flex flex-wrap items-end gap-3">
                      <Fit value={score.fit} size="large" />
                      <span className="pb-0.5 text-sm text-muted-foreground">
                        {t("compare.outOfHundred")}
                      </span>
                    </div>
                    <div className="mt-4">
                      <ScoreBar
                        parts={score}
                        t={t}
                      />
                    </div>
                    <div className="mt-3">
                      <Legend t={t} />
                    </div>
                    <p className="type-caption-sm mt-4 max-w-[68ch] text-muted-foreground">
                      {t("compare.canonicalScoreNote")}
                    </p>

                    {reasons.length > 0 && (
                      <ul className="mt-4 list-disc space-y-1 pl-5 type-caption-sm text-muted-foreground">
                        {reasons.map((reason, index) => (
                          <li key={`${reason.code}-${index}`}>{renderScoreMessage(reason, t)}</li>
                        ))}
                      </ul>
                    )}

                    {blockers.length > 0 && (
                      <p className="mt-4 type-caption-sm text-destructive">
                        ⚠ {blockers.map((blocker) => renderScoreMessage(blocker, t)).join("; ")}
                      </p>
                    )}

                    {(matched.length > 0 || missing.length > 0) && (
                      <>
                        <Separator className="my-5" />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <h3 className="font-mono type-micro text-muted-foreground uppercase">
                              {t("compare.matchedKeywords")}
                            </h3>
                            <div data-user-content className="mt-2 flex flex-wrap gap-1.5">
                              {matched.map((term) => (
                                <Badge key={term} variant="secondary" className="font-mono type-meta">
                                  {term}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h3 className="font-mono type-micro text-muted-foreground uppercase">
                              {t("compare.missingKeywords")}
                            </h3>
                            <div data-user-content className="mt-2 flex flex-wrap gap-1.5">
                              {missing.map((term) => (
                                <Badge key={term} variant="outline" className="font-mono type-meta">
                                  {term}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">{t("compare.noScore")}</p>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href={`/jobs/${detail.job.id}`} className={buttonVariants({ variant: "outline" })}>
                    {t("compare.openJob")}
                  </Link>
                  {externalUrl && (
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noopener"
                      className={buttonVariants({ variant: "outline" })}
                    >
                      {t("compare.openOriginal")} ↗
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="comparison-cv-coverage">
              <CardHeader>
                <CardTitle className="type-display-xs">{t("compare.cvCoverageTitle")}</CardTitle>
                <CardDescription>{t("compare.cvCoverageLead")}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {!cv && (
                  <p className="text-muted-foreground">{t("compare.noCvCoverage")}</p>
                )}

                {cv && vocabulary && vocabulary.items.length === 0 && (
                  <p className="text-muted-foreground">{t("compare.noRecognizedSkills")}</p>
                )}

                {cv && vocabulary && vocabulary.items.length > 0 && (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <p className="font-mono text-2xl font-bold tabular-nums">
                          {Math.round(vocabulary.coverage.weighted * 100)}%
                        </p>
                        <p className="font-mono type-micro text-muted-foreground uppercase">
                          {t("compare.coverage")}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-2xl font-bold tabular-nums">
                          {vocabulary.coverage.covered}
                        </p>
                        <p className="font-mono type-micro text-muted-foreground uppercase">
                          {t("compare.covered")}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-2xl font-bold tabular-nums">
                          {vocabulary.coverage.vocabulary}
                        </p>
                        <p className="font-mono type-micro text-muted-foreground uppercase">
                          {t("compare.vocabularyGaps")}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-2xl font-bold tabular-nums">
                          {vocabulary.coverage.missing}
                        </p>
                        <p className="font-mono type-micro text-muted-foreground uppercase">
                          {t("compare.notEvidenced")}
                        </p>
                      </div>
                    </div>

                    {covered.length > 0 && (
                      <div className="mt-6">
                        <h3 className="font-medium">{t("compare.coveredTitle")}</h3>
                        <div data-user-content className="mt-2 flex flex-wrap gap-1.5">
                          {covered.map((item) => (
                            <Badge key={item.skill.slug} variant="secondary">
                              {item.marketTerm}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {vocabulary.quickWins.length > 0 && (
                      <div className="mt-6">
                        <h3 className="font-medium">{t("compare.vocabularyTitle")}</h3>
                        <p className="type-caption-sm mt-1 text-muted-foreground">
                          {t("compare.vocabularyHint")}
                        </p>
                        <ul data-user-content className="mt-3 space-y-2">
                          {vocabulary.quickWins.map((item) => (
                            <li key={item.skill.slug} className="rounded-lg border p-3 type-caption-sm">
                              <strong>{item.marketTerm}</strong>
                              <span className="text-muted-foreground">
                                {` · ${t("compare.cvUses")} ${item.cvTerms.join(", ")}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {vocabulary.realGaps.length > 0 && (
                      <div className="mt-6">
                        <h3 className="font-medium">{t("compare.notEvidencedTitle")}</h3>
                        <p className="type-caption-sm mt-1 text-muted-foreground">
                          {t("compare.notEvidencedHint")}
                        </p>
                        <div data-user-content className="mt-3 flex flex-wrap gap-1.5">
                          {vocabulary.realGaps.map((item) => (
                            <Badge key={item.skill.slug} variant="outline">
                              {item.marketTerm}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="type-display-xs">{t("compare.savedDescription")}</CardTitle>
                {metadata?.sourceFilename && (
                  <CardDescription data-user-content>
                    {metadata.sourceFilename}
                    {metadata.pages ? ` · ${metadata.pages} ${t("compare.pages")}` : ""}
                    {metadata.documentFormat ? ` · ${metadata.documentFormat}` : ""}
                    {metadata.warningCount > 0
                      ? ` · ${t("compare.extractionWarnings", { count: metadata.warningCount })}`
                      : ""}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <details>
                  <summary className="cursor-pointer font-medium text-[var(--primary-text)]">
                    {t("compare.showDescription")}
                  </summary>
                  <pre data-user-content className="mt-4 max-h-[520px] overflow-auto break-words font-sans type-body-sm whitespace-pre-wrap text-muted-foreground">
                    {detail.job.descriptionText}
                  </pre>
                </details>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </main>
  );
}
