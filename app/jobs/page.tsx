import { listBoard } from "../../src/core/db/repo.ts";
import { JobList } from "../page";
import { Legend } from "../ui";

export const dynamic = "force-dynamic";

const CUTS = [0, 45, 55, 60, 70] as const;

export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<{ fit?: string; cluster?: string }>;
}) {
  const params = await searchParams;
  const minFit = Number(params.fit ?? 45);
  let rows = await listBoard({ minFit, limit: 400 });
  if (params.cluster) rows = rows.filter((r) => r.cluster === params.cluster);

  const clusters = [...new Set(rows.map((r) => r.cluster).filter(Boolean))] as string[];

  return (
    <main>
      <header style={{ padding: "40px 0 20px" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 8px" }}>
          Vagas
        </h1>
        <p style={{ color: "var(--text-2)", margin: 0 }}>
          {rows.length} acima de {minFit} de aderência.
        </p>
      </header>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 18, fontSize: 13 }}>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="mono" style={{ color: "var(--text-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em" }}>
            corte
          </span>
          {CUTS.map((c) => (
            <a
              key={c}
              href={`/jobs?fit=${c}${params.cluster ? `&cluster=${params.cluster}` : ""}`}
              className="mono"
              style={{
                padding: "2px 8px",
                borderRadius: 3,
                textDecoration: "none",
                background: minFit === c ? "var(--accent)" : "var(--sunk)",
                color: minFit === c ? "#fff" : "var(--text-2)",
              }}
            >
              {c}
            </a>
          ))}
        </span>

        {clusters.length > 0 && (
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono" style={{ color: "var(--text-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em" }}>
              cluster
            </span>
            <a
              href={`/jobs?fit=${minFit}`}
              className="mono"
              style={{
                padding: "2px 8px",
                borderRadius: 3,
                textDecoration: "none",
                background: !params.cluster ? "var(--accent)" : "var(--sunk)",
                color: !params.cluster ? "#fff" : "var(--text-2)",
              }}
            >
              todos
            </a>
            {clusters.map((c) => (
              <a
                key={c}
                href={`/jobs?fit=${minFit}&cluster=${c}`}
                className="mono"
                style={{
                  padding: "2px 8px",
                  borderRadius: 3,
                  textDecoration: "none",
                  background: params.cluster === c ? "var(--accent)" : "var(--sunk)",
                  color: params.cluster === c ? "#fff" : "var(--text-2)",
                }}
              >
                {c}
              </a>
            ))}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <Legend />
      </div>
      <JobList rows={rows.slice(0, 120)} />
      {rows.length > 120 && (
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 16 }}>
          Mostrando 120 de {rows.length}. Suba o corte para refinar.
        </p>
      )}
    </main>
  );
}
