import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  followedCandidateName,
  parseCandidateSelector,
  searchJobsToSuggest,
} from "../../../../src/contexts/pursuit/index.ts";
import { requirePage, requireSession } from "../../../auth";
import { getTranslator } from "../../../i18n";
import { TransitionGetForm } from "../../../transition-get-form";
import { TransitionLink } from "../../../transition-link";
import { CandidateName } from "../../recruiter-ui";
import { suggestJobAction } from "./actions";
import { SuggestJobForm } from "./suggest-form";

export const dynamic = "force-dynamic";

/** Códigos de recusa da sugestão que a tela traduz (`suggestionError.*`). */
const ERROR_CODES = [
  "note_too_long",
  "job_closed",
  "already_suggested",
  "already_decided_by_candidate",
  "cap_reached",
  "not_found",
  "pick_job",
  "unexpected",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("recruiter.suggestTitle"), robots: { index: false, follow: false } };
}

/**
 * Sugerir uma vaga do acervo a um candidato acompanhado (#465, US-018): busca
 * por título ou empresa entre as vagas abertas, escolha e nota opcional. Vaga
 * que ainda não está no acervo é cadastrada em `/jobs/new` com `suggestFor`.
 *
 * Mesma porta da página do candidato: fora do vínculo da sessão, o 404 de
 * sempre; dentro, a política de sugerir decide. Nada aqui lê o funil — a tela
 * não diz se a vaga já está lá (US-018.EC-5).
 */
export default async function SuggestJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getTranslator();
  const session = await requireSession();
  const candidateId = parseCandidateSelector((await params).candidateId);
  if (candidateId === null || !session.linkedCandidateIds.includes(candidateId)) {
    notFound();
  }
  await requirePage("suggestion:create", { kind: "candidate", candidateId });

  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const person = await followedCandidateName(session, candidateId);
  if (person === null) notFound();
  const jobs = await searchJobsToSuggest(session, candidateId, query);
  const errors = Object.fromEntries(ERROR_CODES.map((code) => [code, t(`suggestionError.${code}`)])) as Record<
    string,
    string
  > & { unexpected: string };

  return (
    <main className="pt-10 pb-16" data-testid="route-recruiter-suggest">
      <TransitionLink
        href={`/recruiter/${candidateId}`}
        data-testid="recruiter-suggest-back"
        className="inline-flex min-h-11 items-center type-body-sm text-[var(--primary-text)] hover:underline xl:min-h-0"
      >
        {t("recruiter.backToCandidate")}
      </TransitionLink>
      <h1 className="type-display-md chevron mt-2 mb-1">{t("recruiter.suggestTitle")}</h1>
      <p className="type-body-md mb-1 break-words" data-testid="recruiter-suggest-for">
        <CandidateName name={person.name} headline={person.headline} t={t} />
      </p>
      <p className="type-meta mb-6 max-w-[62ch] text-muted-foreground">{t("recruiter.suggestLead")}</p>

      <TransitionGetForm
        key={query}
        action={`/recruiter/${candidateId}/suggest` as Route}
        className="mb-6 flex flex-wrap items-end gap-3"
        data-testid="suggest-search"
      >
        <label className="grid min-w-0 flex-1 gap-1.5 type-body-sm">
          {t("recruiter.searchLabel")}
          <Input name="q" type="search" defaultValue={query} maxLength={120} data-testid="suggest-search-input" />
        </label>
        <Button type="submit" variant="outline" className="min-h-11" data-testid="suggest-search-submit">
          {t("recruiter.searchSubmit")}
        </Button>
      </TransitionGetForm>

      {jobs.length === 0 ? (
        <Card className="mb-6 p-6 text-sm text-muted-foreground" data-testid="suggest-no-results">
          {t("recruiter.noResults")}
        </Card>
      ) : (
        <SuggestJobForm
          action={suggestJobAction}
          candidateId={candidateId}
          jobs={jobs}
          locale={locale}
          labels={{
            job: t("recruiter.jobLabel"),
            note: t("recruiter.noteLabel"),
            noteHint: t("recruiter.noteHint"),
            submit: t("recruiter.submitSuggestion"),
            suggested: t("recruiter.suggested"),
          }}
          errors={errors}
        />
      )}

      <p className="type-body-sm mt-6">
        <TransitionLink
          href={`/jobs/new?suggestFor=${candidateId}` as Route}
          className="inline-flex min-h-11 items-center text-[var(--primary-text)] underline xl:min-h-0"
          data-testid="suggest-register-job"
        >
          {t("recruiter.registerInstead")}
        </TransitionLink>
      </p>
    </main>
  );
}
