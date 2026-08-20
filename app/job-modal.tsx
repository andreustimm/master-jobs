import { RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { recheckAction } from "./actions";
import { cn } from "@/lib/utils";
import type { BoardRow } from "../src/core/db/repo.ts";
import { formatNumber, type LocaleId } from "../src/core/i18n/index.ts";

/**
 * The full job description, offline, in a modal.
 *
 * Built on the native Popover API rather than a component library, which means
 * it costs **zero JavaScript**: the browser handles opening, light dismiss,
 * Escape, focus and the top layer. That keeps the invariant this dashboard is
 * built on — every page is a Server Component and ships no client bundle.
 *
 * The content is the page the scraper captured, so opening it neither hits the
 * employer's server nor tells them you looked.
 */

/** Chaves de tradução, não texto — a mesma lição da legenda do score. */
const FIELD_LABEL: Record<string, string> = {
  employmentType: "jobDetail.employmentType",
  workplace: "jobDetail.workplace",
  seniority: "jobDetail.seniority",
  salary: "score.compensation",
  visa: "jobDetail.visa",
};

type Extracted = {
  title?: string | null;
  fields?: Record<string, string>;
  requirements?: string[];
};

export function JobModal({
  row,
  t,
  locale,
}: {
  row: BoardRow;
  locale: LocaleId;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const id = `job-modal-${row.jobId}`;
  const extracted = (row.pageExtracted ?? {}) as Extracted;
  const fields = extracted.fields ?? {};
  const requirements = extracted.requirements ?? [];
  const text = row.pageText;
  // The list truncates in SQL so a page of rows does not weigh a megabyte.
  const truncated = row.pageTextLength > (text?.length ?? 0);

  return (
    <div
      id={id}
      popover="auto"
      className={cn(
        "m-auto max-h-[85dvh] w-[min(92vw,760px)] overflow-y-auto rounded-xl bg-card p-0 text-card-foreground",
        "ring-1 ring-foreground/10 backdrop:bg-black/40",
      )}
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] bg-card px-5 py-4">
        <div className="min-w-0">
          <h2 className="type-display-xs leading-tight">{row.title}</h2>
          <p className="type-body-sm mt-0.5 text-muted-foreground">{row.companyName}</p>
        </div>
        {/* popoverTargetAction="hide" is the whole close button. No handler. */}
        <button
          type="button"
          popoverTarget={id}
          popoverTargetAction="hide"
          aria-label="Fechar"
          className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
        >
          ×
        </button>
      </header>

      <div className="px-5 py-4">
        {Object.keys(fields).length > 0 && (
          <dl className="mb-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {Object.entries(fields).map(([key, value]) => (
              <div key={key} className="flex items-baseline gap-2">
                <dt className="type-body-sm shrink-0 text-muted-foreground">
                  {FIELD_LABEL[key] ? t(FIELD_LABEL[key]) : key}
                </dt>
                <dd className="type-body-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mb-5 flex flex-wrap gap-2">
          {row.cluster && (
            <Badge variant="outline" className="font-mono type-micro">
              {row.cluster}
            </Badge>
          )}
          {row.locationRaw && (
            <Badge variant="outline" className="type-micro">
              {row.locationRaw.slice(0, 70)}
            </Badge>
          )}
          {/* Estado do link. Uma vaga não é permanente: o anúncio sai, o link
              expira, e a sincronização não sabe disso porque várias fontes
              continuam listando anúncio morto. Aqui se vê quando foi a última
              conferência e o que ela achou. */}
          <Badge
            variant="outline"
            className={cn(
              "type-micro",
              row.checkStatus === "gone" && "border-[var(--bad)] text-[var(--bad)]",
              row.checkStatus === "alive" && "border-[var(--good)] text-[var(--good)]",
              row.checkStatus !== "gone" && row.checkStatus !== "alive" && "text-muted-foreground",
            )}
          >
            {row.checkStatus === "alive"
              ? t("jobDetail.checkedAlive")
              : row.checkStatus === "gone"
                ? t("jobDetail.checkedGone")
                : row.checkStatus === "inconclusive"
                  ? t("jobDetail.checkedInconclusive")
                  : t("jobDetail.checkedNever")}
            {row.checkedAt ? ` · ${row.checkedAt.slice(0, 10)}` : ""}
          </Badge>
          {row.pageFetchedAt && (
            <Badge variant="outline" className="type-micro text-muted-foreground">
              {t("jobDetail.capturedOn")} {row.pageFetchedAt.slice(0, 10)}
            </Badge>
          )}
        </div>

        {requirements.length > 0 && (
          <section className="mb-5">
            <h3 className="type-body-sm mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
              {t("jobDetail.requirements")}
            </h3>
            <ul className="space-y-1.5">
              {requirements.slice(0, 40).map((line, i) => (
                <li key={i} className="type-body-sm flex gap-2">
                  <span className="text-[var(--color-brand)]">·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="type-body-sm mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
            {t("jobDetail.fullDescription")}
          </h3>
          {text ? (
            <>
              {/* `whitespace-pre-wrap` keeps the paragraph structure the
                  extractor preserved. Rendered as text, never as HTML: this
                  came from a third-party page. */}
              <p className="type-body-sm whitespace-pre-wrap leading-relaxed">{text}</p>
              {truncated && (
                <p className="type-body-sm mt-3 border-t border-[var(--color-hairline)] pt-3 text-muted-foreground">
                  {t("jobDetail.previewOf", {
                    shown: formatNumber(text.length, locale),
                    total: formatNumber(row.pageTextLength, locale),
                  })}{" "}
                  <a href={`/jobs/${row.jobId}`} className="text-[var(--primary-text)] hover:underline">
                    {t("jobDetail.openFull")}
                  </a>
                </p>
              )}
            </>
          ) : (
            <p className="type-body-sm text-muted-foreground">
              {t("jobDetail.notCaptured")}{" "}
              <code className="rounded bg-[var(--color-cloud)] px-1 py-0.5 font-mono text-xs">
                jho scrape queue &amp;&amp; jho scrape run
              </code>{" "}
              {t("jobDetail.fetchHint")}
            </p>
          )}
        </section>
      </div>

      <footer className="sticky bottom-0 flex flex-wrap gap-2 border-t border-[var(--color-hairline)] bg-card px-5 py-3">
        <a
          href={row.url}
          target="_blank"
          rel="noopener"
          className="type-body-sm text-[var(--primary-text)] hover:underline"
        >
          {t("jobDetail.openOnSite")} →
        </a>

        {/* Enfileira e volta. Sondar dentro do clique penduraria a página pelo
            tempo de rede de um site de terceiro — e é justamente no link morto
            que ele demora mais, até o timeout. */}
        <form action={recheckAction} className="contents">
          <input type="hidden" name="jobId" value={row.jobId} />
          <button
            type="submit"
            disabled={row.checkQueue === "pending" || row.checkQueue === "checking"}
            title={t("jobDetail.recheckHint")}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 type-body-sm",
              "text-[var(--primary-text)] hover:underline",
              "disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline",
            )}
          >
            <RotateCw className="size-3.5" aria-hidden />
            {row.checkQueue === "pending"
              ? t("jobDetail.recheckQueued")
              : row.checkQueue === "checking"
                ? t("jobDetail.recheckChecking")
                : t("jobDetail.recheck")}
          </button>
        </form>
        {row.applyUrl && row.applyUrl !== row.url && (
          <a
            href={row.applyUrl}
            target="_blank"
            rel="noopener"
            className="type-body-sm ml-auto font-medium text-[var(--primary-text)] hover:underline"
          >
            {t("jobs.apply")} →
          </a>
        )}
      </footer>
    </div>
  );
}
