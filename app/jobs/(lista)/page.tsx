import type { Route } from "next";
import { headers } from "next/headers";
import { after } from "next/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FilterBar } from "../../filters";
import { GridToolbar, Pagination, Presets } from "../../grid";
import { JobList } from "../../joblist";
import { Legend } from "../../ui";
import { candidateScope, requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { TransitionLink } from "../../transition-link";
import { loadJobsView } from "../jobs-data";
import { comVigia, criarCronometro, registrarTempo } from "../../timeout-watch.ts";
import { ScoreQueueCard, isRecalculating } from "../../score-queue-card";
import { candidateScoreQueueStatus } from "../../../src/core/scoring/queue.ts";

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
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const page = Math.max(1, Number(one("page") ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(one("size") ?? 50)));
  const dense = one("dense") === "1";

  // O vigia cobre a autenticação e TODAS as leituras — ver `app/page.tsx` para
  // por que ele não envolve a renderização.
  //
  // Esta é a tela mais aberta do produto e era a que mais pedia conexões: cinco
  // ao mesmo tempo, seis com faixa salarial, contra um pool de três. O aviso aos
  // 22 segundos não corrige nada; garante que uma recaída deixe rastro em vez de
  // virar um `FUNCTION_INVOCATION_TIMEOUT` mudo, como aconteceu por semanas.
  const { candidateId, view, queue } = await comVigia("/jobs", async () => {
    // `job:read`, não `candidate:read`.
    //
    // O acervo é GLOBAL e a política concede leitura aos três papéis. A página
    // pedia escopo de candidato, e o efeito era um recrutador entrar com a senha
    // certa e receber 403 aqui — cada metade correta sozinha, a composição
    // contradizendo a política. Nenhum teste puro vê isso; só um browser
    // entrando como recrutador.
    //
    // `candidateId` pode ser null. Nota de aderência, trilhas e termos salvos
    // são de UMA pessoa: para quem não é candidato eles simplesmente não
    // existem.
    const timer = criarCronometro();
    // No `finally`: a leitura que falha ou estoura é a que mais precisa da medida.
    try {
      const session = await timer.time("auth", () => requirePage("job:read"));
      const escopo = candidateScope(session);
      const lido = await loadJobsView({
        candidateId: escopo,
        params,
        page,
        pageSize,
        // O roteador pré-carrega links visíveis; isso não é visita.
        prefetch: (await headers()).get("next-router-prefetch") === "1",
        schedule: (task) => after(task),
        now: new Date(),
        timer,
      });
      // Com uma trilha escolhida e a fila pendente, as notas na tela são as
      // anteriores: dizer isso é o que evita ler a edição como ignorada.
      const fila =
        escopo !== null && lido.state.track !== undefined
          ? await timer.time("queue", () => candidateScoreQueueStatus(escopo))
          : null;
      return { candidateId: escopo, view: lido, queue: fila };
    } finally {
      registrarTempo(timer.report("/jobs"));
    }
  });
  const { state, total, offer, broughtBy } = view;
  const showTrack = view.scope?.mode === "best";
  const trackNames = Object.fromEntries(view.tracks.map((track) => [track.id, track.name]));

  const empty = broughtBy
    ? t("jobs.broughtByEmpty", { term: broughtBy.term, state: t(`termRun.${broughtBy.run}`) })
    : state.query
      ? t("jobs.emptyTerm", { term: state.query.raw })
      : undefined;

  return (
    <main className="page-content-top" data-testid="route-jobs">
      <header className="pb-4">
        <h1 className="type-display-md chevron mb-4">{t("jobs.title")}</h1>
        {/* `data-testid` porque este é o número que o FILTRO produz, e a lista
            abaixo mostra só uma página dele. Sem ele, um teste de filtro só
            alcança o tamanho da página — que com mil vagas no acervo é o mesmo
            antes e depois de filtrar, e a asserção passa sem medir nada. */}
        <p className="type-body-md text-muted-foreground" data-testid="jobs-total" data-total={total}>
          {total.toLocaleString(locale)} {t("jobs.matching")}
          {state.query ? ` ${t("jobs.matchingFor", { term: state.query.raw })}` : ""}.
        </p>
        {view.hiddenByPayRange > 0 && (
          <p className="type-caption-md text-muted-foreground" data-testid="jobs-hidden-by-pay-range">
            {t("jobs.hiddenByPayRange", { count: view.hiddenByPayRange.toLocaleString(locale) })}
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

      {/* Fora da lista e do total: são vagas que a consulta NÃO casou, só de
          título parecido. Sem a extensão de trigrama, nada aparece — nem o
          rótulo, para a tela não prometer um grupo que não existe. */}
      {view.near?.available && view.near.rows.length > 0 && (
        <section className="mt-6" aria-labelledby="jobs-near-title" data-testid="jobs-near">
          <h2 id="jobs-near-title" className="type-display-xs mb-1">{t("jobs.nearTitle")}</h2>
          <p className="type-caption-md mb-3 text-muted-foreground">{t("jobs.nearHint")}</p>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {view.near.rows.map((row) => (
              <li key={row.jobId} className="px-4 py-3" data-testid={`jobs-near-${row.jobId}`}>
                <TransitionLink href={`/jobs/${row.jobId}`} className="type-body-md font-semibold hover:underline">
                  {row.title}
                </TransitionLink>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span data-user-content>{row.companyName}</span>
                  {row.locationRaw && <span data-user-content>{` · ${row.locationRaw.slice(0, 62)}`}</span>}
                  {` · ${t("jobs.matchProximity")}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
