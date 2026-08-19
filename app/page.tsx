import Link from "next/link";
import { boardFacets, clusterBreakdown, corpusStats, listBoard, pipelineCounts } from "../src/core/db/repo.ts";
import { FilterBar, readFilters, toBoardFilters } from "./filters";
import { JobList } from "./joblist";
import { Legend, Stat } from "./ui";
import { requirePage } from "./auth";

export const dynamic = "force-dynamic";

export default async function Cockpit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePage("job:read");

  const state = readFilters(await searchParams);
  const filters = toBoardFilters(state);

  const [stats, counts, clusters, top, facets] = await Promise.all([
    corpusStats(),
    pipelineCounts(),
    clusterBreakdown(45),
    listBoard({ ...filters, limit: 12 }),
    boardFacets({ minFit: state.fit, cluster: state.cluster, q: state.q, sourceKind: state.source }),
  ]);

  const tracked = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <main>
      <header className="pt-11 pb-6">
        <p className="mb-3 font-mono type-meta tracking-[.14em] text-muted-foreground uppercase">
          Cockpit
        </p>
        <h1 className="type-display-lg chevron mb-4 text-balance">
          O que vale seu tempo hoje
        </h1>
        <p className="type-body-md max-w-[62ch] text-muted-foreground">
          Ranqueamento determinístico contra o seu perfil. Cada barra mostra{" "}
          <strong className="text-foreground">de onde veio a nota</strong> — aderência alta
          sustentada só por elegibilidade e salário costuma ser falso positivo.
        </p>
      </header>

      <div className="mb-7 grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-px overflow-hidden rounded-xl border bg-border">
        <Stat value={stats?.open?.toLocaleString("pt-BR") ?? "0"} label="vagas abertas" />
        <Stat value={stats?.companies?.toLocaleString("pt-BR") ?? "0"} label="empresas" />
        <Stat value={facets.named.toLocaleString("pt-BR")} label="empresa nomeada" />
        <Stat value={facets.unblocked} label="sem bloqueio" accent />
        <Stat value={facets.fresh} label="últimos 3 dias" accent />
        <Stat value={Number(stats?.best ?? 0).toFixed(0)} label="melhor fit" />
        <Stat value={tracked} label="no funil" />
      </div>

      <FilterBar base="/" state={state} facets={facets} />

      <section>
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="type-display-sm">
            Topo do ranking
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              · {facets.total} correspondem
            </span>
          </h2>
          <Link href="/jobs" className="text-sm text-primary hover:underline">
            ver todas →
          </Link>
        </div>
        <div className="mt-3 mb-4">
          <Legend />
        </div>
        <JobList rows={top} />
      </section>

      {clusters.length > 0 && (
        <section className="mt-11">
          <h2 className="type-display-sm mb-2">Por cluster</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Acima do corte de 45, no acervo inteiro.
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
