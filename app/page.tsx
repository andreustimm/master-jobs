import { TransitionLink } from "./transition-link";
import { boardFacets, clusterBreakdown, corpusStats, listBoard } from "../src/contexts/matching/index.ts";
import { pipelineCounts } from "../src/contexts/pursuit/index.ts";
import { FilterBar, readFilters, toBoardFilters } from "./filters";
import { JobList } from "./joblist";
import { Legend, Stat } from "./ui";
import { redirect } from "next/navigation";
import { requireOwnCandidatePage, requireSession } from "./auth";
import { getTranslator } from "./i18n";

export const dynamic = "force-dynamic";

export default async function Cockpit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getTranslator();
  // Sem escopo de candidato, o cockpit não é negado — é REDIRECIONADO.
  //
  // 403 aqui seria correto e inútil: o recrutador não tem funil nem currículo,
  // e dizer "proibido" para quem nunca poderia ter aquilo é resposta certa para
  // a pergunta errada. Pior com a PWA instalada: `start_url` é "/" e não pode
  // variar por papel, então o app abriria numa tela de erro — reintroduzindo,
  // pela porta do manifest, o defeito que a E-06 corrigiu.
  const session = await requireSession();
  if (session.candidateId === null) redirect("/jobs");

  const { candidateId } = await requireOwnCandidatePage("candidate:read");

  const state = readFilters(await searchParams);
  const filters = toBoardFilters(state);

  const [stats, counts, clusters, top, facets] = await Promise.all([
    corpusStats(candidateId),
    pipelineCounts(candidateId),
    clusterBreakdown(candidateId, 45),
    listBoard(candidateId, { ...filters, limit: 12 }),
    boardFacets(candidateId, { minFit: state.fit, cluster: state.cluster, q: state.q, sourceKind: state.source }),
  ]);

  const tracked = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <main className="page-content-top" data-testid="route-cockpit">
      <header className="pb-6">
        <p className="mb-3 font-mono type-meta tracking-[.14em] text-muted-foreground uppercase">
          {t("nav.cockpit")}
        </p>
        <h1 className="type-display-lg chevron mb-4 text-balance">
          {t("cockpit.title")}
        </h1>
        <p className="type-body-md max-w-[62ch] text-muted-foreground">
          {t("cockpit.lead")}{" "}
          <strong className="text-foreground">{t("cockpit.leadStrong")}</strong>{" "}
          {t("cockpit.leadTail")}
        </p>
      </header>

      <div className="mb-7 grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-px overflow-hidden rounded-xl border bg-border">
        <Stat value={stats?.open?.toLocaleString(locale) ?? "0"} label={t("cockpit.openJobs")} />
        <Stat value={stats?.companies?.toLocaleString(locale) ?? "0"} label={t("cockpit.companies")} />
        <Stat value={facets.named.toLocaleString(locale)} label={t("cockpit.namedEmployer")} />
        <Stat value={facets.unblocked} label={t("cockpit.unblocked")} accent />
        <Stat value={facets.fresh} label={t("cockpit.lastThreeDays")} accent />
        <Stat value={Number(stats?.best ?? 0).toFixed(0)} label={t("cockpit.bestFit")} />
        <Stat value={tracked} label={t("cockpit.inPipeline")} />
      </div>

      <FilterBar base="/" state={state} facets={facets} t={t} />

      <section>
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="type-display-sm">
            {t("cockpit.topRanked")}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              · {t("cockpit.matching", { count: facets.total.toLocaleString(locale) })}
            </span>
          </h2>
          <TransitionLink href="/jobs" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
            {t("cockpit.seeAll")} →
          </TransitionLink>
        </div>
        <div className="mt-3 mb-4">
          <Legend t={t} />
        </div>
        <JobList rows={top} t={t} locale={locale} />
      </section>

      {clusters.length > 0 && (
        <section className="mt-11">
          <h2 className="type-display-sm mb-2">{t("filters.cluster")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("jobDetail.aboveCut", { cut: state.fit })}
          </p>
          <div className="grid max-w-[560px] gap-2.5">
            {clusters.map((c) => {
              const max = Math.max(...clusters.map((x) => Number(x.n)));
              return (
                <div key={c.cluster}>
                  <div className="flex justify-between type-caption-sm">
                    <span className="font-mono">{c.cluster}</span>
                    <span className="font-mono text-muted-foreground">
                      {c.n} · melhor {Number(c.best).toFixed(0)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-sm bg-border">
                    <span
                      className="block h-full rounded-sm bg-primary"
                      style={{ width: `${(Number(c.n) / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
