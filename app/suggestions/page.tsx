import type { Metadata, Route } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { candidateSuggestionsFor, type CandidateSuggestionView } from "../../src/contexts/pursuit/index.ts";
import type { LocaleId, Translator } from "../../src/core/i18n/index.ts";
import { AccessActionButton, type ErrorLabels } from "../account/recruiter-access-forms";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";
import { DatedText, Pager } from "../recruiter/recruiter-ui";
import { TransitionLink } from "../transition-link";
import { acceptSuggestionAction, declineSuggestionAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("suggestions.title") };
}

type T = Translator["t"];
type Row = CandidateSuggestionView["rows"][number];

const STATUS_KEY = {
  pending: "suggestions.statusPending",
  accepted: "suggestions.statusAccepted",
  declined: "suggestions.statusDeclined",
} as const;

/**
 * As sugestões de vaga que recrutadores com acesso fizeram ao candidato
 * (#465, US-020 – US-022). Só ele aceita — a vaga entra no funil em Backlog
 * pela ação dele — ou recusa, e o funil não muda (regra 2, ADR-015).
 *
 * Sugestão de quem perdeu o acesso continua aqui, marcada, e continua
 * decidível (US-020.EC-2). Nota e nome do recrutador são dado de usuário,
 * mostrados como texto literal. Sessão emprestada vê tudo e não tem botão de
 * decidir (US-020.EC-6): a política nega `suggestion:decide` a ela.
 */
export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getTranslator();
  const { session } = await requireOwnCandidatePage("candidate:read");
  const view = await candidateSuggestionsFor(session, (await searchParams).page);
  const borrowed = session.impersonatedBy !== null;
  const errors: ErrorLabels = {
    not_found: t("suggestionError.not_found"),
    already_decided: t("suggestionError.already_decided"),
    unexpected: t("suggestionError.unexpected"),
  };

  return (
    <main className="pt-10 pb-16" data-testid="route-suggestions">
      <h1 className="type-display-md chevron mb-4">{t("suggestions.title")}</h1>
      <p className="type-body-md mb-6 max-w-[62ch] text-muted-foreground">{t("suggestions.lead")}</p>
      {borrowed && (
        <p className="type-body-sm mb-6 max-w-[62ch]" data-testid="suggestions-borrowed">
          {t("suggestions.borrowed")}
        </p>
      )}

      {view.rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="suggestions-empty">
          {t("suggestions.empty")}
        </Card>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {view.rows.map((row) => (
            <SuggestionItem key={row.id} row={row} borrowed={borrowed} errors={errors} t={t} locale={locale} />
          ))}
        </ul>
      )}

      <Pager
        page={view.page}
        pages={view.pages}
        href={(page) => (page > 1 ? `/suggestions?page=${page}` : "/suggestions") as Route}
        testId="suggestions-pagination"
        t={t}
      />
    </main>
  );
}

function SuggestionItem({
  row,
  borrowed,
  errors,
  t,
  locale,
}: {
  row: Row;
  borrowed: boolean;
  errors: ErrorLabels;
  t: T;
  locale: LocaleId;
}) {
  return (
    <li className="grid gap-2 bg-card px-4 py-4 sm:px-5" data-testid="suggestion-item" data-status={row.status} data-job-id={row.jobId}>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <TransitionLink href={`/jobs/${row.jobId}`} className="font-semibold break-words hover:underline" data-testid="suggestion-job">
          <span data-user-content>{row.title}</span>
        </TransitionLink>
        <Badge variant="outline" className="font-mono type-micro" data-testid="suggestion-status">
          {t(STATUS_KEY[row.status])}
        </Badge>
        {row.jobClosed && (
          <Badge variant="outline" className="font-mono type-micro text-muted-foreground" data-testid="suggestion-closed">
            {t("pipeline.jobClosed")}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span data-user-content data-testid="suggestion-company">
          {row.company}
        </span>
        <span data-testid="suggestion-score">
          {t("suggestions.score", { score: row.fit === null ? t("suggestions.noScore") : String(Math.round(row.fit)) })}
        </span>
        <DatedText t={t} keyName="recruiter.suggestedOn" iso={row.createdAt} locale={locale} />
      </div>
      <div className="grid gap-1.5">
        <span className="type-micro text-muted-foreground">{t("suggestions.by")}</span>
        {row.recruiters.map((recruiter, index) => (
          <div key={index} className="grid gap-0.5" data-testid="suggestion-recruiter">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="type-body-sm font-medium break-words" data-user-content data-testid="suggestion-recruiter-name">
                {recruiter.name}
              </span>
              {recruiter.accessEnded && (
                <Badge variant="outline" className="font-mono type-micro text-muted-foreground" data-testid="suggestion-access-ended">
                  {t("suggestions.accessEnded")}
                </Badge>
              )}
            </div>
            {recruiter.note !== null && (
              <p className="type-body-sm whitespace-pre-wrap break-words" data-user-content data-testid="suggestion-note">
                {recruiter.note}
              </p>
            )}
          </div>
        ))}
      </div>
      {row.status === "pending" && !borrowed && (
        <div className="flex flex-wrap gap-2">
          <AccessActionButton
            action={acceptSuggestionAction}
            fields={{ suggestionId: row.id }}
            label={t("suggestions.accept")}
            testId="suggestion-accept"
            success={t("suggestions.accepted")}
            errors={errors}
            locale={locale}
          />
          <AccessActionButton
            action={declineSuggestionAction}
            fields={{ suggestionId: row.id }}
            label={t("suggestions.decline")}
            testId="suggestion-decline"
            success={t("suggestions.declined")}
            errors={errors}
            locale={locale}
          />
        </div>
      )}
    </li>
  );
}
