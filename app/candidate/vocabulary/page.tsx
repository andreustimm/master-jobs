import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { currentDocument } from "../../../src/core/candidate.ts";
import { vocabularyGap } from "../../../src/contexts/skills/index.ts";
import type { GapItem } from "../../../src/contexts/skills/index.ts";
import { requireOwnCandidatePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { formatNumber, type Translator } from "../../../src/core/i18n/index.ts";

export const dynamic = "force-dynamic";

const MIN_FIT = 60;

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/**
 * A demand bar. Deliberately plain: the number is the message, and a chart
 * here would decorate rather than inform.
 */
function Demand({ value, tone }: { value: number; tone: "win" | "gap" | "ok" }) {
  const color =
    tone === "win"
      ? "bg-[var(--color-strong)]"
      : tone === "gap"
        ? "bg-[var(--color-mid)]"
        : "bg-[var(--color-steel)]";
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-fog)]">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
      <span className="type-mono-sm tabular-nums text-muted-foreground">{pct(value)}</span>
    </div>
  );
}

function QuickWin({ item, t }: { item: GapItem; t: Translator["t"] }) {
  return (
    <li className="border-b border-[var(--color-hairline)] py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="type-body-lg font-medium">{item.marketTerm}</span>
          <Badge variant="outline" className="type-micro uppercase tracking-wide">
            {item.skill.category}
          </Badge>
        </div>
        <Demand value={item.demand} tone="win" />
      </div>
      <p className="type-body-sm mt-1 text-muted-foreground">
        {t("vocabulary.cvWrites")}{" "}
        {item.cvTerms.map((t, i) => (
          <span key={t}>
            {i > 0 && ", "}
            <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">{t}</code>
          </span>
        ))}{" "}
        — {item.jobCount} {t("vocabulary.jobsWrite")}{" "}
        <strong className="text-foreground">{item.marketTerm}</strong>.
      </p>
    </li>
  );
}

export default async function VocabularyPage() {
  const { t, locale } = await getTranslator();
  // Guard antes de ler qualquer dado. O escopo vem da sessão.
  const { candidateId } = await requireOwnCandidatePage("candidate:read");
  const doc = await currentDocument(candidateId, "cv");

  if (!doc) {
    return (
      <main className="pt-10 pb-16">
        <h1 className="type-display-md chevron mb-2">{t("vocabulary.title")}</h1>
        <p className="type-body-md text-muted-foreground">
          {t("vocabulary.noCv")}{" "}
          <Link href="/candidate" className="text-[var(--primary-text)] hover:underline">
            {t("vocabulary.pasteCv")}
          </Link>{" "}
          {t("vocabulary.toCompare")}
        </p>
      </main>
    );
  }

  const report = await vocabularyGap({ candidateId, cvText: doc.content, minFit: MIN_FIT });

  return (
    <main className="pt-10 pb-16">
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="type-display-md chevron">{t("vocabulary.title")}</h1>
        <Link href="/candidate" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          ← {t("vocabulary.backToCv")}
        </Link>
        <Link href="/candidate/skills" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          skills →
        </Link>
      </div>

      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.vocabLead", { jobs: formatNumber(report.totalJobs, locale), cut: MIN_FIT })}
      </p>

      <div className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <div className="type-display-sm tabular-nums">{pct(report.coverage.weighted)}</div>
          <div className="type-body-sm text-muted-foreground">
            {t("vocabulary.coverageNote")}
          </div>
        </div>
        <span className="type-body-sm text-muted-foreground">
          {report.coverage.covered} {t("vocabulary.covered_n")} ·{" "}
          {report.coverage.vocabulary} {t("vocabulary.vocabularyOf")} ·{" "}
          {report.coverage.missing} {t("vocabulary.realGaps")}
        </span>
      </div>

      {report.quickWins.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-0">
            <h2 className="type-display-xs mb-1">{t("vocabulary.quickWin")}</h2>
            <p className="type-body-sm mb-2 text-muted-foreground">
              {t("copy.quickWinNote")}
            </p>
            <ul>
              {report.quickWins.map((item) => (
                <QuickWin key={item.skill.slug} item={item} t={t} />
              ))}
            </ul>
            <p className="type-body-sm mt-4 border-t border-[var(--color-hairline)] pt-4 text-muted-foreground">
              {t("copy.quickWinWarn")}{" "}
              <strong className="text-foreground">{t("vocabulary.doNotInvent")}</strong>{" "}
              {t("copy.quickWinWarnTail")}
            </p>
          </CardContent>
        </Card>
      )}

      {report.realGaps.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-0">
            <h2 className="type-display-xs mb-1">{t("vocabulary.realGap")}</h2>
            <p className="type-body-sm mb-4 text-muted-foreground">
              {t("copy.realGapNote")}
            </p>
            <ul>
              {report.realGaps.map((item) => (
                <li
                  key={item.skill.slug}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-hairline)] py-3 last:border-0"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="type-body-md">{item.marketTerm}</span>
                    <Badge variant="outline" className="type-micro uppercase tracking-wide">
                      {item.skill.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="type-body-sm tabular-nums text-muted-foreground">
                      {item.jobCount} {t("vocabulary.jobs")}
                    </span>
                    <Demand value={item.demand} tone="gap" />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-0">
          <h2 className="type-display-xs mb-4">{t("vocabulary.covered")}</h2>
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {report.items
              .filter((i) => i.kind === "covered")
              .map((item) => (
                <li key={item.skill.slug} className="flex items-baseline justify-between gap-3">
                  <span className="type-body-sm text-muted-foreground">{item.marketTerm}</span>
                  <Demand value={item.demand} tone="ok" />
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
