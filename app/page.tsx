import { TransitionLink } from "./transition-link";
import { loadCockpit } from "./cockpit-data.ts";
import { comVigia, criarCronometro, registrarTempo } from "./timeout-watch.ts";
import { FilterBar, href, readFilters, toBoardFilters } from "./filters";
import { JobList } from "./joblist";
import { Legend, Stat } from "./ui";
import { redirect } from "next/navigation";
import { candidateScope, requireOwnCandidatePage, requireSession } from "./auth";
import { getTranslator } from "./i18n";

export const dynamic = "force-dynamic";

export default async function Cockpit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getTranslator();
  // O vigia cobre a AUTENTICAÇÃO e as leituras, não só as leituras.
  //
  // A espera por conexão atinge a primeira consulta da requisição, e
  // `requireOwnCandidatePage` já vai ao banco: envolver só `loadCockpit` deixava
  // a janela aberta justamente onde o defeito mora.
  //
  // O que ele NÃO envolve é a renderização. Envolver o componente inteiro num
  // promise devolvido por um helper muda a forma como a árvore é transmitida, e
  // o commit da rota passa a acontecer numa só pintura — o que apaga o overlay
  // de transição que a suíte de browser observa no redirect do login. O vigia
  // existe para medir espera de banco; a árvore não é problema dele.
  const { state, dados } = await comVigia("/", async () => {
    // Sem escopo de candidato, o cockpit não é negado — é REDIRECIONADO.
    //
    // 403 aqui seria correto e inútil: o recrutador não tem funil nem currículo,
    // e dizer "proibido" para quem nunca poderia ter aquilo é resposta certa
    // para a pergunta errada. Pior com a PWA instalada: `start_url` é "/" e não
    // pode variar por papel, então o app abriria numa tela de erro —
    // reintroduzindo, pela porta do manifest, o defeito que a E-06 corrigiu.
    const timer = criarCronometro();
    // No `finally`: a leitura que falha ou estoura é a que mais precisa da medida.
    try {
      const candidateId = await timer.time("auth", async () => {
        const session = await requireSession();
        if (candidateScope(session) === null) redirect("/jobs");
        return (await requireOwnCandidatePage("candidate:read")).candidateId;
      });

      const lido = readFilters(await searchParams);
      const dados = await timer.time("cockpit", () => loadCockpit(candidateId, lido, toBoardFilters(lido)));
      return { state: lido, dados };
    } finally {
      registrarTempo(timer.report("/"));
    }
  });
  const { stats, counts, clusters, total, top, facets } = dados;

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
              · {t("cockpit.matching", { count: total.toLocaleString(locale) })}
            </span>
          </h2>
          <TransitionLink href={href("/jobs", state, {})} data-testid="cockpit-see-all" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
            {t("cockpit.seeAll")} →
          </TransitionLink>
        </div>
        <div className="mt-3 mb-4">
          <Legend t={t} />
        </div>
        <JobList rows={top} t={t} locale={locale} context={{ triage: true }} />
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
