import Link from "next/link";
import { pipelineCounts, pipelineRows } from "../../src/core/db/repo.ts";
import { APPLICATION_STATUSES } from "../../src/core/db/schema.ts";
import { Chip, Fit } from "../ui";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const [counts, rows] = await Promise.all([pipelineCounts(), pipelineRows()]);

  return (
    <main style={{ paddingTop: 40 }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 8px" }}>
        Funil
      </h1>
      <p style={{ color: "var(--text-2)", maxWidth: "62ch", margin: "0 0 28px" }}>
        A única coisa que o sistema não consegue recriar. Nenhuma ingestão
        escreve aqui — só você.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 32 }}>
        {APPLICATION_STATUSES.filter((s) => counts[s]).map((s) => (
          <div
            key={s}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "10px 16px",
              minWidth: 96,
            }}
          >
            <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {counts[s]}
            </div>
            <div
              className="mono"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-3)", marginTop: 3 }}
            >
              {s}
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--text-3)" }}>
          Nada no funil ainda. Comece pela <Link href="/jobs" style={{ color: "var(--accent)" }}>lista de vagas</Link>.
        </p>
      ) : (
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
          {rows.map((r) => (
            <div
              key={r.jobId}
              style={{
                background: "var(--surface)",
                display: "grid",
                gridTemplateColumns: "56px 1fr auto",
                gap: 16,
                alignItems: "center",
                padding: "14px 18px",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <Fit value={r.fit} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <Link
                    href={`/jobs/${r.jobId}`}
                    style={{ fontWeight: 600, color: "var(--text)", textDecoration: "none" }}
                  >
                    {r.title}
                  </Link>
                  <Chip>{r.status}</Chip>
                  {r.channel && <Chip tone="muted">{r.channel}</Chip>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3 }}>
                  {r.companyName}
                  {r.appliedAt ? ` · aplicado em ${r.appliedAt.slice(0, 10)}` : ""}
                </div>
                {r.nextAction && (
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
                    próximo: {r.nextAction}
                  </div>
                )}
              </div>
              <a
                className="mono"
                href={r.url}
                target="_blank"
                rel="noopener"
                style={{ fontSize: 12, color: "var(--accent)", whiteSpace: "nowrap" }}
              >
                abrir →
              </a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
