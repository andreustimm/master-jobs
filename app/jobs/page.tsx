import type { Route } from "next";
import { headers } from "next/headers";
import { after } from "next/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FilterBar } from "../filters";
import { GridToolbar, Pagination, Presets } from "../grid";
import { JobList } from "../joblist";
import { Legend } from "../ui";
import { candidateScope, requirePage } from "../auth";
import { getTranslator } from "../i18n";
import { TransitionLink } from "../transition-link";
import { loadJobsView } from "./jobs-data";
import { ScoreQueueCard, isRecalculating } from "../score-queue-card";
import { candidateScoreQueueStatus } from "../../src/core/scoring/queue.ts";

export const dynamic = "force-dynamic";

export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getTranslator();
  // `job:read`, não `candidate:read`.
  //
  // O acervo é GLOBAL e a política concede leitura aos três papéis. A página
  // pedia escopo de candidato, e o efeito era um recrutador entrar com a senha
  // certa e receber 403 aqui — cada metade correta sozinha, a composição
  // contradizendo a política. Nenhum teste puro vê isso; só um browser entrando
  // como recrutador.
  //
  // `candidateId` pode ser null. Nota de aderência, trilhas e termos salvos são
  // de UMA pessoa: para quem não é candidato eles simplesmente não existem.
  const session = await requirePage("job:read");
  const candidateId = candidateScope(session);

  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const page = Math.max(1, Number(one("page") ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(one("size") ?? 50)));
  const dense = one("dense") === "1";

  const view = await loadJobsView({
    candidateId,
    params,
    page,
    pageSize,
    // O roteador pré-carrega links visíveis; isso não é visita.
    prefetch: (await headers()).get("next-router-prefetch") === "1",
    schedule: (task) => after(task),
    now: new Date(),
  });
  const { state, total, offer, broughtBy } = view;
  // Com uma trilha escolhida e a fila pendente, as notas na tela são as
  // anteriores: dizer isso é o que evita ler a edição como ignorada.
  const queue = candidateId !== null && state.track !== undefined ? await candidateScoreQueueStatus(candidateId) : null;
  const showTrack = view.scope?.mode === "best";
  const trackNames = Object.fromEntries(view.tracks.map((track) => [track.id, track.name]));

  const empty = broughtBy
    ? t("jobs.broughtByEmpty", { term: broughtBy.term, state: t(`termRun.${broughtBy.run}`) })
    : state.term
      ? t("jobs.emptyTerm", { term: state.term.term })
      : undefined;

  return (
    <main className="page-content-top" data-testid="route-jobs">
      <header className="pb-4">
        <h1 className="type-display-md chevron mb-4">{t("jobs.title")}</h1>
        <p className="type-body-md text-muted-foreground">
          {total.toLocaleString(locale)} {t("jobs.matching")}
          {state.term ? ` ${t("jobs.matchingFor", { term: state.term.term })}` : ""}.
        </p>
        {view.hiddenBelowMinimum > 0 && (
          <p className="type-caption-md text-muted-foreground" data-testid="jobs-hidden-below-minimum">
            {t("jobs.hiddenBelowMinimum", { count: view.hiddenBelowMinimum.toLocaleString(locale) })}
          </p>
        )}
      </header>

      {queue && isRecalculating(queue) && (
        <ScoreQueueCard snapshot={queue} hasCv locale={locale} t={t} recalculating />
      )}

      {view.notices.length > 0 && (
        <Card className="mb-4 gap-1 p-4" role="status" data-testid="jobs-notices">
          {view.notices.map((notice) => (
            <p key={notice} className="type-body-md" data-testid={`jobs-notice-${notice}`}>
              {t(`filterNotices.${notice}`)}
            </p>
          ))}
        </Card>
      )}

      {offer && (
        <Card
          className={cn("mb-4 flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between", offer.emphasized && "border-primary")}
          data-testid="jobs-offer-search"
          data-emphasized={offer.emphasized ? "true" : "false"}
        >
          <p className="type-body-md text-muted-foreground">{t("jobs.offerSearchLead")}</p>
          <TransitionLink
            href={`/searches/tracks/new?term=${encodeURIComponent(offer.term)}` as Route}
            // A sugestão de trilha é montada no servidor para o termo; buscá-la
            // de antemão a cada termo digitado seria trabalho jogado fora.
            prefetch={false}
            className={cn(buttonVariants({ variant: offer.emphasized ? "default" : "outline", size: "sm" }))}
            data-testid="jobs-offer-search-link"
          >
            {t("jobs.offerSearch", { term: offer.term })}
          </TransitionLink>
        </Card>
      )}

      <Presets base="/jobs" t={t} />
      <FilterBar
        base="/jobs"
        state={state}
        facets={view.facets}
        extras={
          candidateId === null
            ? undefined
            : { tracks: view.tracks, savedTerms: view.savedTerms, currencies: view.currencies, pay: view.pay }
        }
        t={t}
      />
      <GridToolbar base="/jobs" state={state} total={total} dense={dense} t={t} />

      <div className="mb-3.5">
        <Legend t={t} />
      </div>

      <JobList
        rows={view.rows}
        dense={dense}
        t={t}
        locale={locale}
        context={{
          trackNames: showTrack ? trackNames : undefined,
          pay: state.pay || state.sort === "comp" ? view.pay : undefined,
          empty,
          triage: candidateId !== null,
        }}
      />

      <Pagination base="/jobs" state={state} page={page} pageSize={pageSize} total={total} t={t} />
    </main>
  );
}
