import type * as React from "react";
import { TransitionLink } from "./transition-link";
import { JobCountries } from "./job-countries";
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
import { explainMatch, type MatchField } from "../src/core/search.ts";
import { formatMoney, money, parseCurrency, parsePeriod } from "../src/core/money.ts";
import { ACTION_BUTTON, ACTION_GROUP, Fit, ScoreBar, StatusBadge } from "./ui";
import { jobOrigin, ORIGIN_LABEL } from "../src/core/job-origin.ts";
import { TriageButton } from "./triage-button";

type Row = Awaited<ReturnType<typeof listBoard>>[number];

/** Chave do dicionário de cada campo onde a consulta pode casar. */
export const MATCH_FIELD_LABEL = {
  title: "jobs.matchTitle",
  company: "jobs.matchCompany",
  location: "jobs.matchLocation",
  description: "jobs.matchDescription",
} as const satisfies Record<MatchField, string>;

function pay(r: Row): string | null {
  const amount = r.compMax ?? r.compMin;
  const currency = parseCurrency(r.compCurrency);
  const period = parsePeriod(r.compPeriod);
  if (!amount || amount <= 0 || !currency || !period) return null;
  return formatMoney(money(amount, currency, period), "pt-BR");
}

/** How the Jobs screen asked rows to be read: which track, which pay unit. */
export type ListContext = {
  /** Track names by id, shown on each row when the view mixes tracks. */
  trackNames?: Record<number, string>;
  /** Currency and period of `payAmount`, when pay was normalized. */
  pay?: { currency: string; period: "month" | "year" };
  /** Replaces the generic empty state (a term, a saved term). */
  empty?: React.ReactNode;
  /** The viewer is the candidate: each row offers "não me interessa" / "restaurar". */
  triage?: boolean;
};

export function JobList({
  rows,
  dense = false,
  locale,
  t,
  context = {},
}: {
  rows: Row[];
  dense?: boolean;
  locale: LocaleId;
  t: Translator["t"];
  context?: ListContext;
}) {
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground" data-testid="jobs-empty">
        {context.empty ?? t("jobs.noneWithFilters")}
      </Card>
    );
  }

  return (
    <div
      className="divide-y overflow-hidden rounded-xl border"
      data-density={dense ? "compact" : "comfortable"}
    >
      {rows.map((r, index) => {
        const blockers = scoreMessages(r.blockers);
        // Mais de uma publicação no grupo: a linha fala pelo conjunto.
        const agrupada = r.repeats.length > 1;
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
                <TransitionLink
                  // A linha agrupada representa N publicações, e mandar o
                  // clique para uma delas entrega um país que ninguém pediu —
                  // o de menor id, que é escolha de ordenação, não de produto.
                  href={agrupada ? `/jobs/${r.jobId}/paises` : `/jobs/${r.jobId}`}
                  data-testid={`job-link-${r.jobId}`}
                  className="type-body-md font-semibold hover:underline"
                >
                  {r.title}
                </TransitionLink>
                {r.status && <StatusBadge status={r.status} t={t} />}
                {r.isNew && (
                  <Badge className="type-micro" data-testid={`job-new-${r.jobId}`}>
                    {t("jobs.newBadge")}
                  </Badge>
                )}
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
                {context.trackNames && r.trackId !== null && context.trackNames[r.trackId] && (
                  <Badge variant="outline" className="type-micro" data-testid={`job-track-${r.jobId}`} data-user-content>
                    {t("jobs.trackLabel", { name: context.trackNames[r.trackId]! })}
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
                {context.pay && r.payState === "amount" && r.payAmount !== null && (
                  <span className="font-mono" data-testid={`job-pay-${r.jobId}`}>
                    {t("jobs.payConverted", {
                      amount: formatMoney(money(r.payAmount, context.pay.currency, context.pay.period), locale),
                    })}
                  </span>
                )}
                {context.pay && r.payState === "undisclosed" && (
                  <Badge variant="outline" className="type-micro" data-testid={`job-pay-undisclosed-${r.jobId}`}>
                    {t("jobs.payUndisclosed")}
                  </Badge>
                )}
                {context.pay && r.payState === "not_comparable" && (
                  <Badge variant="outline" className="type-micro" data-testid={`job-pay-not-comparable-${r.jobId}`}>
                    {t("jobs.payNotComparable")}
                  </Badge>
                )}
                {r.repeats.length > 1 ? (
                  <JobCountries jobId={r.jobId} repeats={r.repeats} locale={locale} t={t} />
                ) : (
                  // `data-user-content` porque a localização vem do acervo, não do
                  // dicionário: "São Paulo, State of São Paulo, Brazil" tem acento
                  // e continua tendo com a interface em inglês. Sem a marca, a
                  // verificação de vazamento de português acusa dado do usuário —
                  // e foi assim que ela reprovou quando `/jobs/<id>/paises` entrou
                  // na varredura. Na linha de Vagas isto escapava porque ali a
                  // localização chega pelas bandeiras, que já tinham a marca.
                  r.locationRaw && (
                    <span className="truncate" data-user-content>
                      {r.locationRaw.slice(0, 62)}
                    </span>
                  )
                )}
              </div>

              {r.matchedFields !== null && r.matchedFields.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground" data-testid={`job-match-${r.jobId}`}>
                  {t("jobs.matchedIn", {
                    fields: explainMatch({ fields: r.matchedFields, proximity: false })
                      .map((signal) => (signal.kind === "field" ? t(MATCH_FIELD_LABEL[signal.field]) : t("jobs.matchProximity")))
                      .join(", "),
                  })}
                </p>
              )}

              {!dense && (
                <div className="mt-2.5">
                  <ScoreBar parts={r} t={t} />
                </div>
              )}

              {!r.hasFullDescription && (
                <p className="mt-2 text-xs text-[var(--color-mid)]">
                  {t("jobs.noDescription")}
                </p>
              )}
              {blockers.length > 0 && (
                <p className="mt-2 text-xs text-destructive">
                  ⚠ {blockers.map((blocker) => renderScoreMessage(blocker, t)).join("; ")}
                </p>
              )}
              {/* Fora do grupo de ações, que exige três botões de largura
                  igual: "não me interessa" não cabe num terço da tela de 320px.
                  Aqui fica ao lado do bloqueio que costuma motivar o clique. */}
              {context.triage && !agrupada && (
                <div className="mt-2 flex">
                  <TriageButton
                    jobId={r.jobId}
                    status={r.status}
                    appliedAt={r.appliedAt}
                    place="row"
                    t={t}
                    className={cn(ACTION_BUTTON, "text-muted-foreground")}
                  />
                </div>
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
            {/* Sem ações na linha agrupada: "Vaga", "Site" e "Aplicar" abrem
                uma publicação específica, e aqui não há uma — há N. A escolha
                do país vem antes, no hub. O mesmo vale para "não me
                interessa", que arquivaria só a publicação canônica. */}
            {!agrupada && (
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
            )}
            {!agrupada && <JobModal row={r} t={t} locale={locale} />}
          </article>
        );
      })}
    </div>
  );
}
