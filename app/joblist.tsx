import type * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { JobModal } from "./job-modal";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LocaleId, Translator } from "../src/core/i18n/index.ts";
import { renderScoreMessage } from "../src/core/i18n/index.ts";
import { scoreMessages } from "../src/contexts/matching/index.ts";
import type { listBoard } from "../src/contexts/matching/index.ts";
import { isPublicJobUrl } from "../src/core/job-url.ts";
import { formatMoney, money, parseCurrency, parsePeriod } from "../src/core/money.ts";
import { ACTION_BUTTON, ACTION_GROUP, Fit, ScoreBar, StatusBadge } from "./ui";
import { jobOrigin, ORIGIN_LABEL } from "../src/core/job-origin.ts";

type Row = Awaited<ReturnType<typeof listBoard>>[number];

function pay(r: Row): string | null {
  const amount = r.compMax ?? r.compMin;
  const currency = parseCurrency(r.compCurrency);
  const period = parsePeriod(r.compPeriod);
  if (!amount || amount <= 0 || !currency || !period) return null;
  return formatMoney(money(amount, currency, period), "pt-BR");
}

export function JobList({
  rows,
  dense = false,
  locale,
  t,
}: {
  rows: Row[];
  dense?: boolean;
  locale: LocaleId;
  t: Translator["t"];
}) {
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {t("jobs.noneWithFilters")}
      </Card>
    );
  }

  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {rows.map((r, index) => {
        const blockers = scoreMessages(r.blockers);
        const salary = pay(r);
        const externalUrl = isPublicJobUrl(r.url);
        const externalApplyUrl = isPublicJobUrl(r.applyUrl) ? r.applyUrl : null;
        // Jobgether and other intermediaries publish under their own name, so
        // the employer is unknowable — worth saying, since you cannot research
        // the company or use your network on one of these.
        const anonymous =
          r.sourceLabel && r.companyName.toLowerCase() === r.sourceLabel.toLowerCase();

        return (
          <article
            key={r.jobId}
            // The stagger reads top-to-bottom, which is the order the list is
            // meant to be triaged in. It saturates at 8 (see .jho-rise): a
            // cascade over a full page of results would be waiting, not motion.
            style={{ "--jho-index": index } as React.CSSProperties}
            className={cn(
              "jho-rise grid grid-cols-[46px_1fr] items-start gap-3 bg-card transition-colors",
              "sm:grid-cols-[58px_1fr_auto] sm:gap-4 hover:bg-muted/40",
              dense ? "px-3 py-2.5 sm:px-4" : "px-4 py-4 sm:px-5",
            )}
          >
            <div className="pt-0.5 text-center">
              <Fit value={r.fit} />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <Link
                  href={`/jobs/${r.jobId}`}
                  className="type-body-md font-semibold hover:underline"
                >
                  {r.title}
                </Link>
                {r.status && <StatusBadge status={r.status} />}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span
                  className={cn("font-semibold", anonymous ? "text-muted-foreground" : "text-foreground")}
                >
                  {anonymous ? `${r.companyName} · ${t("jobs.anonymousEmployer")}` : r.companyName}
                </span>
                {r.cluster && (
                  <Badge variant="outline" className="font-mono type-micro text-[var(--primary-text)]">
                    {r.cluster}
                  </Badge>
                )}
                {/* De onde a vaga veio. Derivado de `source.kind` na leitura,
                    nunca de coluna denormalizada — esta é a mesma armadilha do
                    `cv_variant`, que guarda um nome e não um vínculo.

                    `web` fica sem rótulo: é a maioria esmagadora do acervo, e
                    marcar o comum só faz o incomum desaparecer no meio. */}
                {jobOrigin(r.sourceId) !== "web" && (
                  <Badge variant="outline" className="type-micro">
                    {t(ORIGIN_LABEL[jobOrigin(r.sourceId)])}
                  </Badge>
                )}
                {salary && <span className="font-mono text-foreground">{salary}</span>}
                {r.locationRaw && <span className="truncate">{r.locationRaw.slice(0, 62)}</span>}
              </div>

              {!dense && (
                <div className="mt-2.5">
                  <ScoreBar parts={r} t={t} />
                </div>
              )}

              {r.descriptionLength < 200 && (
                <p className="mt-2 text-xs text-[var(--color-mid)]">
                  {t("jobs.noDescription")}
                </p>
              )}
              {blockers.length > 0 && (
                <p className="mt-2 text-xs text-destructive">
                  ⚠ {blockers.map((blocker) => renderScoreMessage(blocker, t)).join("; ")}
                </p>
              )}
            </div>

            {/* Three actions, because they answer three different questions.
                "Vaga" reads the description we captured — offline, and without
                telling the employer you looked. "Site" is the posting itself.
                "Aplicar" is the form, which on Lever is a different URL from
                the description: sending someone to a form for a job they have
                not read is the wrong default.

                On mobile they sit in a row under the content; from `sm` up they
                stack in the right-hand column. */}
            <div className={cn("col-span-2 sm:col-span-1 sm:pt-0.5", ACTION_GROUP)}>
              <button
                type="button"
                popoverTarget={`job-modal-${r.jobId}`}
                popoverTargetAction="show"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  ACTION_BUTTON,
                  !r.pageText && "opacity-60",
                )}
                title={r.pageText ? t("jobDetail.fullDescription") : t("jobDetail.notCaptured")}
              >
                {t("jobs.view")}
              </button>
              {externalUrl && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), ACTION_BUTTON)}
                >
                  {t("jobs.site")} ↗
                </a>
              )}
              {externalApplyUrl && externalApplyUrl !== r.url && (
                <a
                  href={externalApplyUrl}
                  target="_blank"
                  rel="noopener"
                  className={cn(buttonVariants({ size: "sm" }), ACTION_BUTTON)}
                >
                  {t("jobs.apply")} →
                </a>
              )}
            </div>
            <JobModal row={r} t={t} locale={locale} />
          </article>
        );
      })}
    </div>
  );
}
