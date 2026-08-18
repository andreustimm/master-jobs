import Link from "next/link";
import { boardFacets, clusterBreakdown, corpusStats, listBoard, pipelineCounts } from "../src/core/db/repo.ts";
import { FilterBar, readFilters, toBoardFilters } from "./filters";
import { Fit, Legend, ScoreBar, Stat, Chip } from "./ui";
import { formatMoney, money, parseCurrency, parsePeriod } from "../src/core/money.ts";

export const dynamic = "force-dynamic";

export default async function Cockpit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
      <header style={{ padding: "44px 0 24px" }}>
        <p
          className="mono"
          style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 12px" }}
        >
          Cockpit
        </p>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 10px" }}>
          O que vale seu tempo hoje
        </h1>
        <p style={{ color: "var(--text-2)", maxWidth: "62ch", margin: 0 }}>
          Ranqueamento determinístico contra o seu perfil. Cada barra mostra{" "}
          <strong>de onde veio a nota</strong> — aderência alta sustentada só por
          elegibilidade e salário costuma ser falso positivo.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(126px, 1fr))",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          overflow: "hidden",
          marginBottom: 28,
        }}
      >
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
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>
            Topo do ranking
            <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: 14 }}>
              {" "}· {facets.total} correspondem
            </span>
          </h2>
          <Link href="/jobs" style={{ fontSize: 13, color: "var(--accent)" }}>
            ver todas →
          </Link>
        </div>
        <div style={{ margin: "12px 0 16px" }}>
          <Legend />
        </div>
        <JobList rows={top} />
      </section>

      {clusters.length > 0 && (
        <section style={{ marginTop: 44 }}>
          <h2 style={{ fontSize: 21, fontWeight: 600, margin: "0 0 4px" }}>Por cluster</h2>
          <p style={{ color: "var(--text-3)", fontSize: 13.5, margin: "0 0 18px" }}>
            Acima do corte de 45, no acervo inteiro.
          </p>
          <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
            {clusters.map((c) => {
              const max = Math.max(...clusters.map((x) => Number(x.n)));
              return (
                <div key={c.cluster}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span className="mono">{c.cluster}</span>
                    <span className="mono" style={{ color: "var(--text-2)" }}>
                      {c.n} · melhor {Number(c.best).toFixed(0)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: "var(--line)", borderRadius: 2, marginTop: 5 }}>
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${(Number(c.n) / max) * 100}%`,
                        background: "var(--accent)",
                        borderRadius: 2,
                      }}
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

type Row = Awaited<ReturnType<typeof listBoard>>[number];

function pay(r: Row): string | null {
  const amount = r.compMax ?? r.compMin;
  const currency = parseCurrency(r.compCurrency);
  const period = parsePeriod(r.compPeriod);
  if (!amount || amount <= 0 || !currency || !period) return null;
  return formatMoney(money(amount, currency, period), "pt-BR");
}

export function JobList({ rows, dense = false }: { rows: Row[]; dense?: boolean }) {
  if (rows.length === 0) {
    return (
      <p
        style={{
          color: "var(--text-3)",
          padding: 24,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
        }}
      >
        Nenhuma vaga com esses filtros. Afrouxe o corte ou desligue algum critério.
      </p>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        background: "var(--line)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {rows.map((r) => {
        const blockers = Array.isArray(r.blockers) ? (r.blockers as string[]) : [];
        const salary = pay(r);
        const anonymous = r.sourceLabel && r.companyName.toLowerCase() === r.sourceLabel.toLowerCase();
        return (
          <article
            key={r.jobId}
            style={{
              background: "var(--surface)",
              display: "grid",
              gridTemplateColumns: "62px 1fr auto",
              gap: 16,
              alignItems: "start",
              padding: dense ? "9px 16px" : "14px 18px",
            }}
          >
            <div style={{ textAlign: "center", paddingTop: 2 }}>
              <Fit value={r.fit} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href={`/jobs/${r.jobId}`}
                  style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}
                >
                  {r.title}
                </Link>
                {r.status && <Chip>{r.status}</Chip>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 4, fontSize: 12.5, color: "var(--text-2)" }}>
                <span style={{ fontWeight: 600, color: anonymous ? "var(--text-3)" : "var(--text)" }}>
                  {anonymous ? `${r.companyName} (empregador oculto)` : r.companyName}
                </span>
                {r.cluster && (
                  <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
                    {r.cluster}
                  </span>
                )}
                {salary && (
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--text)" }}>
                    {salary}
                  </span>
                )}
                {r.locationRaw && <span>{r.locationRaw.slice(0, 62)}</span>}
              </div>
              {!dense && (
                <div style={{ marginTop: 9 }}>
                  <ScoreBar parts={r as unknown as Record<string, number | null>} />
                </div>
              )}
              {r.descriptionLength < 200 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-mid)" }}>
                  sem descrição — a nota está subestimada, não baixa
                </div>
              )}
              {blockers.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-alert)" }}>
                  ⚠ {blockers.join("; ")}
                </div>
              )}
            </div>
            {/* Two links, because they are two different pages. On Lever the
                /apply suffix opens the form directly, while the bare URL is
                where the job description lives — sending someone straight to a
                form they have not read is the wrong default. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 3 }}>
              <a
                className="mono"
                href={r.url}
                target="_blank"
                rel="noopener"
                style={{
                  fontSize: 12,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--line)",
                  textAlign: "center",
                }}
              >
                ver vaga
              </a>
              {r.applyUrl && r.applyUrl !== r.url && (
                <a
                  className="mono"
                  href={r.applyUrl}
                  target="_blank"
                  rel="noopener"
                  style={{
                    fontSize: 12,
                    color: "#fff",
                    background: "var(--accent)",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                    padding: "4px 10px",
                    borderRadius: 4,
                    textAlign: "center",
                  }}
                >
                  aplicar →
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
